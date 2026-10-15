const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { fork, execFile } = require('node:child_process');
const { app, BrowserWindow, shell, dialog, Menu, ipcMain, session, net: electronNet } = require('electron');

/**
 * DHVANI desktop shell.
 *
 * Electron's only jobs here are to start the backend as a child process, point
 * a window at it, and shut it down cleanly. The app itself is the same Express
 * server and the same built frontend the other distributions use, so there is
 * no desktop-only code path to keep in sync.
 */

/**
 * The window always loads APP_URL, whatever port the engine really gets. The
 * page's saved data (localStorage) belongs to that exact origin, port and all,
 * so moving the page to another port would make it look lost. When APP_PORT
 * is taken (or reserved by Windows for Hyper-V/WSL/Docker), the engine starts
 * on a free port instead and requests to APP_URL are passed on to it.
 */
const APP_PORT = Number(process.env.PORT) || 8788; // Offset from the dev default.
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
let enginePort = APP_PORT;
const RELEASES_API = 'https://api.github.com/repos/mahadeva112/dhvani/releases/latest';

/**
 * The app root, holding `server/`, `dist/` and `node_modules/`.
 *
 * Packaged, this file sits at `resources/app/desktop/main.cjs`; in development
 * it sits at `<repo>/desktop/main.cjs`. One level up is correct in both cases.
 */
const APP_ROOT = path.join(__dirname, '..');

let backend = null;
let mainWindow = null;
let backendReady = false; // Set once the engine answers; until then the window shows loading.html.
let isQuitting = false;

/**
 * Portable mode: keep keys, settings and logs next to the executable.
 *
 * Two shapes count as portable. The single-file `portable` target sets
 * PORTABLE_EXECUTABLE_DIR to the folder the .exe was launched from; the
 * unpacked zip has no such hint, so it opts in with a `dhvani-data` folder
 * sitting beside DHVANI.exe. Either way the data folder travels with the app
 * instead of living in AppData, which is the whole point of a portable build.
 *
 * Must run before the first `app.getPath('userData')` call below.
 */
const resolvePortableDataDir = () => {
  const beside = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  if (!beside) return null;

  // The NSIS build ships the same `dhvani-data` folder, but an installed copy
  // must keep using AppData so an uninstall/reinstall cannot lose the keys.
  // Only the installer leaves an uninstaller beside the executable.
  if (fs.existsSync(path.join(beside, `Uninstall ${app.getName()}.exe`))) return null;

  const dataDir = path.join(beside, 'dhvani-data');
  const optedIn = Boolean(process.env.PORTABLE_EXECUTABLE_DIR) || fs.existsSync(dataDir);
  if (!optedIn) return null;

  // An app dropped in Program Files (or on read-only media) cannot write next
  // to itself. Falling back to AppData beats failing to start.
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    return dataDir;
  } catch {
    return null;
  }
};

if (app.isPackaged) {
  const portableDataDir = resolvePortableDataDir();
  if (portableDataDir) app.setPath('userData', portableDataDir);
}

const logFile = path.join(app.getPath('userData'), 'backend.log');

const appendLog = (line) => {
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // Logging must never take the app down.
  }
};

/**
 * App updates from GitHub Releases, driven from the page.
 *
 * The page shows an Update button when a newer published release exists; the
 * user chooses when to download it and when to restart into it. Nothing
 * downloads on its own.
 *
 * Only the Windows installer and the Linux AppImage can replace themselves.
 * The zip and the single-file portable cannot be swapped in place (the updater
 * would install a second, separate copy), and unsigned macOS builds are
 * refused by Squirrel. Those builds still learn about a new version from the
 * releases API, and download the matching file into Downloads from inside the
 * app. Nothing the user sees names or links to where releases are hosted.
 */
const canSelfUpdate = () => {
  if (process.env.DHVANI_UPDATE_FEED_URL) return true; // Local update testing; see setupAutoUpdates.
  if (!app.isPackaged) return false;
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  if (process.platform !== 'win32') return false;
  return fs.existsSync(path.join(path.dirname(app.getPath('exe')), `Uninstall ${app.getName()}.exe`));
};

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INSTALL_NOTICE_MS = 1500;

let autoUpdater = null;

/** What the page renders. Every change is pushed to it whole. */
let updateState = {
  status: 'idle', // idle | checking | available | not-available | downloading | downloaded | installing | error
  canInstall: false,
  // The installer relaunches the app with --updated after a self-update.
  justUpdated: process.argv.includes('--updated'),
  currentVersion: app.getVersion(),
  version: null,
  releaseNotes: '',
  releaseDate: null,
  percent: 0,
  transferred: 0,
  total: 0,
  error: null,
};

const setUpdateState = (patch) => {
  updateState = { ...updateState, ...patch };
  mainWindow?.webContents.send('updates:state', updateState);
  if (updateState.status === 'downloading') mainWindow?.setProgressBar(updateState.percent / 100);
  else if (updateState.status === 'installing') mainWindow?.setProgressBar(2, { mode: 'indeterminate' });
  else mainWindow?.setProgressBar(-1);
};

/**
 * Release notes arrive as HTML or Markdown; the page shows plain text, without
 * the links, contributor handles and changelog footer the release host adds.
 */
const plainNotes = (notes) =>
  (Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : notes || '')
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/^.*(full changelog|new contributors|made their first contribution).*$/gim, '')
    .replace(/\s+by @[\w-]+/g, '')
    .replace(/\s+in\s+https?:\/\/\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\bgithub\b/gi, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);

/** Updater errors can quote the release host's URLs; the page gets a short plain message. */
const plainError = (err) => {
  appendLog(`[updater] ${err?.stack || err}\n`);
  const text = String(err?.message || err || '')
    .split('\n')[0]
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\bgithub\b/gi, 'the update server')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text.slice(0, 160) || 'Unknown error';
};

/** The file in a release that replaces this build, for builds that cannot install. */
const pickAsset = (assets) => {
  const files = (assets || []).filter((a) => a?.name && a?.browser_download_url);
  const find = (re) => files.find((a) => re.test(a.name));
  if (process.platform === 'win32') {
    return process.env.PORTABLE_EXECUTABLE_DIR ? find(/-Portable-x64\.exe$/i) : find(/-Portable-x64\.zip$/i);
  }
  if (process.platform === 'darwin') return find(process.arch === 'arm64' ? /-arm64\.dmg$/i : /-x64\.dmg$/i);
  if (process.platform === 'linux') return find(/\.AppImage$/i);
  return null;
};

let releaseAsset = null; // { name, url, size } of the newer release's file, from the API check.
let downloadedFile = null; // Where that file was saved.

/** 1.2.10 is newer than 1.2.9. Pre-release suffixes are ignored. */
const isNewer = (candidate, current) => {
  const parts = (v) => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0);
  const [a, b] = [parts(candidate), parts(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/** Builds that cannot install still deserve to hear about a new version. */
const checkReleasesApi = async () => {
  setUpdateState({ status: 'checking', error: null });
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.status === 404) {
      setUpdateState({ status: 'not-available' }); // Nothing published yet.
      return;
    }
    if (!response.ok) throw new Error(`The update server answered ${response.status}`);
    const release = await response.json();
    if (isNewer(release.tag_name, app.getVersion())) {
      const asset = pickAsset(release.assets);
      releaseAsset = asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size || 0 } : null;
      setUpdateState({
        status: 'available',
        version: String(release.tag_name).replace(/^v/, ''),
        releaseNotes: plainNotes(release.body),
        releaseDate: release.published_at || null,
      });
    } else {
      setUpdateState({ status: 'not-available' });
    }
  } catch (err) {
    setUpdateState({ status: 'error', error: plainError(err) });
  }
};

/** Saves the newer release's file into Downloads, with progress, for builds that cannot install. */
const downloadReleaseAsset = async () => {
  if (!releaseAsset) {
    setUpdateState({ error: 'This version has no download for this computer yet.' });
    return;
  }
  setUpdateState({ status: 'downloading', percent: 0, transferred: 0, total: releaseAsset.size, error: null });
  // The single-file portable goes beside the old one, so it finds the same
  // dhvani-data folder and keeps the keys; anything else goes to Downloads.
  const besideOld = process.env.PORTABLE_EXECUTABLE_DIR;
  let folder = app.getPath('downloads');
  try {
    if (besideOld) {
      fs.accessSync(besideOld, fs.constants.W_OK);
      folder = besideOld;
    }
  } catch {
    // Read-only location: Downloads it is.
  }
  const target = path.join(folder, releaseAsset.name);
  const partial = `${target}.part`;
  try {
    const response = await fetch(releaseAsset.url);
    if (!response.ok || !response.body) throw new Error(`The download answered ${response.status}`);
    const total = Number(response.headers.get('content-length')) || releaseAsset.size || 0;
    const out = fs.createWriteStream(partial);
    let transferred = 0;
    let lastPush = 0;
    for await (const chunk of response.body) {
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
      transferred += chunk.length;
      if (Date.now() - lastPush > 200) {
        lastPush = Date.now();
        setUpdateState({ transferred, total, percent: total ? (transferred / total) * 100 : 0 });
      }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    fs.renameSync(partial, target);
    downloadedFile = target;
    setUpdateState({ status: 'downloaded', percent: 100, transferred, total });
  } catch (err) {
    try {
      fs.rmSync(partial, { force: true });
    } catch {
      // A stray .part file is harmless.
    }
    setUpdateState({ status: 'available', error: plainError(err) });
  }
};

const checkForUpdates = () => {
  if (['checking', 'downloading', 'downloaded', 'installing'].includes(updateState.status)) return;
  if (!autoUpdater) {
    checkReleasesApi();
    return;
  }
  setUpdateState({ status: 'checking', error: null });
  autoUpdater.checkForUpdates().catch(() => {}); // Reported through 'error'.
};

const setupAutoUpdates = () => {
  ipcMain.handle('updates:get-state', () => updateState);
  ipcMain.handle('updates:check', () => checkForUpdates());
  ipcMain.handle('updates:download', () => {
    if (updateState.status !== 'available') return;
    if (!autoUpdater) {
      downloadReleaseAsset();
      return;
    }
    setUpdateState({ status: 'downloading', percent: 0, transferred: 0, error: null });
    autoUpdater.downloadUpdate().catch(() => {}); // Reported through 'error'.
  });
  ipcMain.handle('updates:install', () => {
    if (!autoUpdater || updateState.status !== 'downloaded') return;
    isQuitting = true;
    setUpdateState({ status: 'installing' });
    // Silent reinstall into the same folder, then relaunch. The pause lets the
    // page show that DHVANI is about to close; the installer shows its own
    // "Updating DHVANI" box until the new version opens (desktop/installer.nsh).
    setTimeout(() => autoUpdater.quitAndInstall(true, true), INSTALL_NOTICE_MS);
  });
  ipcMain.handle('updates:show-download', () => downloadedFile && shell.showItemInFolder(downloadedFile));

  if (canSelfUpdate()) {
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (err) {
      appendLog(`[updater] unavailable: ${err.message}\n`);
    }
  }

  if (autoUpdater) {
    autoUpdater.logger = {
      info: (m) => appendLog(`[updater] ${m}\n`),
      warn: (m) => appendLog(`[updater] warn: ${m}\n`),
      error: (m) => appendLog(`[updater] error: ${m}\n`),
      debug: () => {},
    };
    // The user decides when to download; "Install when I close" covers the rest.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // For trying an update end to end without publishing a release: point the
    // app at a folder served over HTTP holding latest.yml and the installer.
    if (process.env.DHVANI_UPDATE_FEED_URL) {
      autoUpdater.forceDevUpdateConfig = !app.isPackaged;
      autoUpdater.setFeedURL({ provider: 'generic', url: process.env.DHVANI_UPDATE_FEED_URL });
    }

    setUpdateState({ canInstall: true });

    autoUpdater.on('update-available', (info) =>
      setUpdateState({
        status: 'available',
        version: info.version,
        releaseNotes: plainNotes(info.releaseNotes),
        releaseDate: info.releaseDate || null,
      })
    );
    autoUpdater.on('update-not-available', () => setUpdateState({ status: 'not-available' }));
    autoUpdater.on('download-progress', (p) =>
      setUpdateState({ status: 'downloading', percent: p.percent, transferred: p.transferred, total: p.total })
    );
    autoUpdater.on('update-downloaded', (info) =>
      setUpdateState({ status: 'downloaded', version: info.version, percent: 100 })
    );
    autoUpdater.on('error', (err) => {
      // A failed download leaves the update on offer, so Retry is one click.
      const wasDownloading = updateState.status === 'downloading';
      setUpdateState({
        status: wasDownloading ? 'available' : 'error',
        error: plainError(err),
      });
    });
  }

  // Give the engine and window a moment before touching the network.
  setTimeout(checkForUpdates, 10_000);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS).unref();
};

/** Help → Check for Updates… opens the page's update window and checks. */
const checkForUpdatesFromMenu = () => {
  mainWindow?.webContents.send('updates:open');
  checkForUpdates();
};

/** `PROXY host:port; DIRECT` → `http://host:port`. Null for DIRECT or SOCKS. */
const proxyUrlFrom = (rule) => {
  const first = String(rule || '').split(';')[0].trim();
  const match = first.match(/^(PROXY|HTTPS)\s+(\S+)$/i);
  if (!match) return null;
  return `${match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`;
};

/** URLs the user saved in Settings: their own gateway or regional hosts. */
const savedEndpoints = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
    return ['llmGatewayUrl', 'geminiBaseUrl', 'elevenLabsBaseUrl', 'cartesiaBaseUrl']
      .map((field) => saved?.[field])
      .filter((value) => typeof value === 'string' && /^https?:\/\//i.test(value));
  } catch {
    return [];
  }
};

/**
 * The proxy Windows (or macOS) is set to use, for the engine.
 *
 * The engine is plain Node, and Node connects directly unless it is told about
 * a proxy. Chrome, curl and Python's urllib all follow the system setting, so
 * on an office network they work while a direct connection is blocked. Asking
 * Chromium covers manual proxies, PAC scripts and auto-detect alike.
 *
 * Hosts the system reaches directly (a gateway on the LAN, for one) go in
 * NO_PROXY so they are not sent through a proxy that cannot reach them.
 */
const systemProxyEnv = async () => {
  // A proxy set by hand in the environment wins.
  if (process.env.HTTPS_PROXY || process.env.https_proxy) return { NODE_USE_ENV_PROXY: '1' };

  try {
    const proxy = proxyUrlFrom(await session.defaultSession.resolveProxy('https://api.elevenlabs.io'));
    if (!proxy) return {};

    const direct = ['localhost', '127.0.0.1', '::1'];
    for (const endpoint of savedEndpoints()) {
      if (!proxyUrlFrom(await session.defaultSession.resolveProxy(endpoint))) {
        direct.push(new URL(endpoint).hostname);
      }
    }

    appendLog(`[network] system proxy ${proxy}; direct for ${direct.join(', ')}\n`);
    return {
      NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: proxy,
      HTTP_PROXY: proxy,
      NO_PROXY: [...new Set([process.env.NO_PROXY, ...direct].filter(Boolean))].join(','),
    };
  } catch (err) {
    appendLog(`[network] could not read the system proxy: ${err.message}\n`);
    return {};
  }
};

/**
 * Resolves true when the port can be listened on. False also covers a port
 * nobody holds but Windows has reserved (an "excluded port range").
 */
const portIsFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });

/** A port the OS says is free right now. */
const anyFreePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** Runs a command and resolves its stdout, or '' if it fails. */
const run = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 10_000, windowsHide: true }, (err, stdout) =>
      resolve(err ? '' : String(stdout).trim())
    );
  });

/**
 * The process listening on the port, as { pid, name, path, command }, or null
 * when it cannot be found out.
 */
const portOwner = async (port) => {
  if (process.platform === 'win32') {
    const script =
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `if ($c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"; ` +
      `[pscustomobject]@{ pid = [int]$c.OwningProcess; name = $p.Name; path = $p.ExecutablePath; command = $p.CommandLine } | ConvertTo-Json -Compress }`;
    // Encoded, so the quotes in the script survive Windows argument quoting.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
    try {
      return out ? JSON.parse(out) : null;
    } catch {
      return null;
    }
  }

  // macOS and Linux: lsof prints "p<pid>" and "c<name>" lines.
  const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
  const pid = Number(/^p(\d+)/m.exec(out)?.[1]);
  return pid ? { pid, name: /^c(.+)/m.exec(out)?.[1] || null, path: null, command: null } : null;
};

/** True when a DHVANI engine (of any copy) answers on the port. */
const dhvaniAnswers = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    return (await response.json())?.service === 'dhvani-backend';
  } catch {
    return false;
  }
};

const waitForPortFree = async (port, ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return portIsFree(port);
};

const stopProcess = async (pid, port) => {
  try {
    process.kill(pid);
  } catch (err) {
    appendLog(`[startup] could not stop PID ${pid}: ${err.message}\n`);
  }
  return waitForPortFree(port, 5000);
};

/**
 * Picks the engine's port. APP_PORT when it is free. An engine left behind by
 * an earlier run of this same copy of DHVANI is stopped without asking (the
 * single-instance lock means no window is using it). Anything else holding
 * APP_PORT, including a Windows port reservation that no program owns, is
 * left alone and the engine takes another free port; routeToEngine() keeps
 * the window on APP_URL, so nothing the user saved moves.
 */
const pickEnginePort = async () => {
  if (await portIsFree(APP_PORT)) return APP_PORT;

  const owner = await portOwner(APP_PORT);
  const isDhvani = await dhvaniAnswers(APP_PORT);
  appendLog(
    `[startup] port ${APP_PORT} is in use by ${owner ? `${owner.name} (PID ${owner.pid}) ${owner.command || owner.path || ''}` : 'no program (reserved by Windows, or unknown)'}\n`
  );

  const leftover =
    owner && isDhvani && owner.path && path.resolve(owner.path) === path.resolve(process.execPath);
  if (leftover) {
    appendLog(`[startup] stopping an engine left behind by an earlier run\n`);
    if (await stopProcess(owner.pid, APP_PORT)) return APP_PORT;
  }

  const port = await anyFreePort();
  appendLog(`[startup] the engine uses port ${port}; the window stays on ${APP_URL}\n`);
  return port;
};

/**
 * When the engine is not on APP_PORT, passes the window's requests for
 * APP_URL on to the engine's real port. Every other http request goes out
 * unchanged.
 */
const routeToEngine = () => {
  if (enginePort === APP_PORT) return;
  session.defaultSession.protocol.handle('http', (request) => {
    const url = new URL(request.url);
    if (url.origin !== APP_URL) return electronNet.fetch(request, { bypassCustomProtocolHandlers: true });
    url.port = String(enginePort);
    const headers = new Headers(request.headers);
    // Uncompressed: a gzipped partial (Range) response cannot be decoded on
    // its own, which broke seeking, and loopback gains nothing from gzip.
    headers.set('Accept-Encoding', 'identity');
    // With an Origin, net.fetch runs a CORS check the engine only answers on
    // /api, so the page's own scripts and styles failed. The page is already
    // same-origin; the engine allows requests without an Origin.
    headers.delete('Origin');
    return electronNet.fetch(url.href, {
      method: request.method,
      headers,
      body: request.body,
      duplex: 'half',
      bypassCustomProtocolHandlers: true,
    });
  });
};

/** Starts the Express backend as a child Node process. */
const startBackend = async () => {
  const proxyEnv = await systemProxyEnv();

  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = () => {
      settled = true;
      resolve();
    };
    const fail = (err) => {
      settled = true;
      reject(err);
    };
    const serverEntry = path.join(APP_ROOT, 'server', 'index.js');

    if (!fs.existsSync(serverEntry)) {
      fail(new Error(`Backend not found at ${serverEntry}`));
      return;
    }

    backend = fork(serverEntry, [], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        ...proxyEnv,
        NODE_ENV: 'production',
        PORT: String(enginePort),
        HOST: '127.0.0.1',
        DHVANI_DESKTOP: 'true',
        // Keys and settings live in the OS user-data folder, not next to the
        // installed binary, so an app update never wipes them.
        DHVANI_CONFIG_DIR: app.getPath('userData'),
        CORS_ORIGIN: APP_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    backend.stdout?.on('data', (chunk) => appendLog(chunk.toString()));
    backend.stderr?.on('data', (chunk) => appendLog(chunk.toString()));

    backend.on('error', fail);

    backend.on('exit', (code) => {
      backend = null;
      // Exiting before it answered is a failed start, whatever the code (the
      // engine exits 0 on an uncaught error), so say so now, not after the timeout.
      if (!settled) {
        fail(new Error(`The DHVANI engine stopped while starting (exit code ${code}).`));
        return;
      }
      if (!isQuitting && code !== 0) {
        dialog.showErrorBox(
          'DHVANI stopped unexpectedly',
          `The DHVANI engine exited with code ${code}.\n\nDetails were written to:\n${logFile}`
        );
        app.quit();
      }
    });

    // Poll the health endpoint rather than guessing a fixed startup delay.
    const deadline = Date.now() + 30_000;
    const probe = async () => {
      if (settled) return;
      // Only our engine counts: another server on the port must not pass for it.
      if (await dhvaniAnswers(enginePort)) {
        succeed();
        return;
      }

      if (Date.now() > deadline) {
        fail(new Error('The DHVANI engine did not start within 30 seconds.'));
        return;
      }
      setTimeout(probe, 250);
    };

    probe();
  });
};

/** A page that hasn't answered a ping for this long is frozen. */
const FREEZE_AFTER_MS = 5000;
/** While a page stays frozen, its call stack is logged again this often. */
const FREEZE_RELOG_MS = 10_000;

/**
 * Logs a frozen page with the script it is stuck in, so a freeze can be
 * traced. The page is pinged every 2 s, so a freeze is caught whether or not
 * the user clicks; Chromium's own unresponsive event needs input to fire.
 */
const watchForFreezes = (win) => {
  const contents = win.webContents;
  let pingSent = 0;
  let frozenSince = 0;
  let lastLogged = 0;
  const logStack = async (seconds) => {
    try {
      const stack = await contents.mainFrame.collectJavaScriptCallStack();
      appendLog(`[hang] ${new Date().toISOString()} the page has not answered for ${seconds} s; it is running:\n${stack || '(not available)'}\n`);
    } catch (err) {
      appendLog(`[hang] ${new Date().toISOString()} the page has not answered for ${seconds} s; its call stack could not be read: ${err?.message || err}\n`);
    }
  };
  const timer = setInterval(() => {
    if (contents.isDestroyed() || contents.isLoading()) return;
    const now = Date.now();
    if (!pingSent) {
      pingSent = now;
      contents
        .executeJavaScript('1', false)
        .then(() => {
          if (frozenSince) appendLog(`[hang] ${new Date().toISOString()} the page answers again after ${Math.round((Date.now() - frozenSince) / 1000)} s\n`);
          pingSent = 0;
          frozenSince = 0;
        })
        .catch(() => {
          pingSent = 0;
        });
      return;
    }
    if (now - pingSent < FREEZE_AFTER_MS || now - lastLogged < FREEZE_RELOG_MS) return;
    frozenSince ||= pingSent;
    lastLogged = now;
    logStack(Math.round((now - pingSent) / 1000));
  }, 2000);
  win.on('closed', () => clearInterval(timer));
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#020617', // Matches the app's dark slate, so no white flash.
    show: false,
    title: 'DHVANI',
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      // The window only ever loads our own local server, and the page has no
      // need for Node. Keeping the renderer sandboxed is the safe default.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Exposes the update controls (window.dhvaniUpdates) and nothing else.
      preload: path.join(__dirname, 'preload.cjs'),
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Anything that is not our local app opens in the user's real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  watchForFreezes(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Until the engine answers, show a "Starting DHVANI" page so the window can
  // open at once rather than leaving the screen blank (most noticeable right
  // after an update, when the installer's box has just closed).
  if (backendReady) mainWindow.loadURL(APP_URL);
  else mainWindow.loadFile(path.join(__dirname, 'loading.html'), { query: startupQuery() });
};

/**
 * What the loading page says under "Starting DHVANI": "Updated to X" on the
 * first start after an update, else the version. The last version that ran is
 * kept in the user-data folder.
 */
const startupQuery = () => {
  const version = app.getVersion();
  const marker = path.join(app.getPath('userData'), 'last-version');
  let previous = null;
  try {
    previous = fs.readFileSync(marker, 'utf8').trim();
  } catch {
    // First run, or the file was removed.
  }
  try {
    if (previous !== version) fs.writeFileSync(marker, version);
  } catch {
    // Not worth failing the start over.
  }
  return { version, updated: previous && previous !== version ? '1' : '0' };
};

// The system message box is white whatever the app looks like, so About is a
// small window of our own (about.html) in the app's colours.
let aboutWindow = null;
const showAbout = () => {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }
  aboutWindow = new BrowserWindow({
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    width: 460,
    height: 340,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    show: false,
    title: 'About DHVANI',
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  aboutWindow.setMenu(null);
  aboutWindow.once('ready-to-show', () => aboutWindow.show());
  aboutWindow.on('closed', () => (aboutWindow = null));
  aboutWindow.loadFile(path.join(__dirname, 'about.html'), { query: { version: app.getVersion() } });
};

// Each version's changes in short lines (whatsnew.html), inside the app.
let whatsNewWindow = null;
const showWhatsNew = () => {
  if (whatsNewWindow) {
    whatsNewWindow.focus();
    return;
  }
  whatsNewWindow = new BrowserWindow({
    parent: mainWindow || undefined,
    width: 520,
    height: 560,
    useContentSize: true,
    minWidth: 420,
    minHeight: 360,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    show: false,
    title: 'What’s New in DHVANI',
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  whatsNewWindow.setMenu(null);
  whatsNewWindow.once('ready-to-show', () => whatsNewWindow.show());
  whatsNewWindow.on('closed', () => (whatsNewWindow = null));
  whatsNewWindow.loadFile(path.join(__dirname, 'whatsnew.html'), { query: { version: app.getVersion() } });
};

const buildMenu = () => {
  const isMac = process.platform === 'darwin';

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      {
        label: 'File',
        submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: 'What’s New',
            click: showWhatsNew,
          },
          {
            label: 'Check for Updates…',
            click: checkForUpdatesFromMenu,
          },
          {
            label: `Version ${app.getVersion()}`,
            enabled: false,
          },
          { type: 'separator' },
          {
            label: 'About DHVANI',
            click: showAbout,
          },
        ],
      },
    ])
  );
};

// A second launch should focus the running window rather than start a second
// backend on the same port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      appendLog(`\n--- DHVANI desktop started ${new Date().toISOString()} ---\n`);
      buildMenu();
      createWindow(); // Shows the loading page while the engine starts.
      setupAutoUpdates();
      enginePort = await pickEnginePort();
      routeToEngine();
      await startBackend();
      backendReady = true;
      mainWindow?.loadURL(APP_URL);
    } catch (err) {
      if (err.silent) {
        app.quit();
        return;
      }
      dialog.showErrorBox(
        'DHVANI could not start',
        `${err.message}\n\nDetails were written to:\n${logFile}`
      );
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (backend) {
    backend.kill('SIGTERM');
    // If it has not gone in two seconds, stop waiting.
    setTimeout(() => backend?.kill('SIGKILL'), 2000);
  }
});
