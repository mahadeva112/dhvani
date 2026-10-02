const path = require('node:path');
const fs = require('node:fs');
const { fork } = require('node:child_process');
const { app, BrowserWindow, shell, dialog, Menu, ipcMain, session } = require('electron');

/**
 * DHVANI desktop shell.
 *
 * Electron's only jobs here are to start the backend as a child process, point
 * a window at it, and shut it down cleanly. The app itself is the same Express
 * server and the same built frontend the other distributions use, so there is
 * no desktop-only code path to keep in sync.
 */

const PORT = Number(process.env.PORT) || 8788; // Offset from the dev default.
const APP_URL = `http://127.0.0.1:${PORT}`;
const RELEASES_URL = 'https://github.com/mahadeva112/dhvani/releases/latest';

/**
 * The app root, holding `server/`, `dist/` and `node_modules/`.
 *
 * Packaged, this file sits at `resources/app/desktop/main.cjs`; in development
 * it sits at `<repo>/desktop/main.cjs`. One level up is correct in both cases.
 */
const APP_ROOT = path.join(__dirname, '..');

let backend = null;
let mainWindow = null;
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
 * refused by Squirrel. Those builds still learn about a new version, from the
 * GitHub API, and are pointed at the Releases page instead.
 */
const canSelfUpdate = () => {
  if (process.env.DHVANI_UPDATE_FEED_URL) return true; // Local update testing; see setupAutoUpdates.
  if (!app.isPackaged) return false;
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  if (process.platform !== 'win32') return false;
  return fs.existsSync(path.join(path.dirname(app.getPath('exe')), `Uninstall ${app.getName()}.exe`));
};

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let autoUpdater = null;

/** What the page renders. Every change is pushed to it whole. */
let updateState = {
  status: 'idle', // idle | checking | available | not-available | downloading | downloaded | error
  canInstall: false,
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
  else mainWindow?.setProgressBar(-1);
};

/** Release notes arrive as GitHub's HTML or Markdown; the page shows plain text. */
const plainNotes = (notes) =>
  (Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : notes || '')
    .replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);

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
    const response = await fetch('https://api.github.com/repos/mahadeva112/dhvani/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.status === 404) {
      setUpdateState({ status: 'not-available' }); // Nothing published yet.
      return;
    }
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = await response.json();
    if (isNewer(release.tag_name, app.getVersion())) {
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
    setUpdateState({ status: 'error', error: err?.message || String(err) });
  }
};

const checkForUpdates = () => {
  if (['checking', 'downloading', 'downloaded'].includes(updateState.status)) return;
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
    if (!autoUpdater || updateState.status !== 'available') return;
    setUpdateState({ status: 'downloading', percent: 0, transferred: 0, error: null });
    autoUpdater.downloadUpdate().catch(() => {}); // Reported through 'error'.
  });
  ipcMain.handle('updates:install', () => {
    if (!autoUpdater || updateState.status !== 'downloaded') return;
    isQuitting = true;
    // Silent reinstall into the same folder, then relaunch.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
  ipcMain.handle('updates:open-releases', () => shell.openExternal(RELEASES_URL));

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
        error: err?.message || String(err),
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

/** Starts the Express backend as a child Node process. */
const startBackend = async () => {
  const proxyEnv = await systemProxyEnv();

  return new Promise((resolve, reject) => {
    const serverEntry = path.join(APP_ROOT, 'server', 'index.js');

    if (!fs.existsSync(serverEntry)) {
      reject(new Error(`Backend not found at ${serverEntry}`));
      return;
    }

    backend = fork(serverEntry, [], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        ...proxyEnv,
        NODE_ENV: 'production',
        PORT: String(PORT),
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

    backend.on('error', reject);

    backend.on('exit', (code) => {
      backend = null;
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
      try {
        const response = await fetch(`${APP_URL}/api/health`);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Not listening yet.
      }

      if (Date.now() > deadline) {
        reject(new Error('The DHVANI engine did not start within 30 seconds.'));
        return;
      }
      setTimeout(probe, 250);
    };

    probe();
  });
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(APP_URL);
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
            label: 'Open Engine Log',
            click: () => shell.openPath(logFile),
          },
          {
            label: 'Open Settings Folder',
            click: () => shell.openPath(app.getPath('userData')),
          },
          { type: 'separator' },
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
            label: 'Documentation',
            click: () => shell.openExternal('https://github.com/dhvani-studio/dhvani#readme'),
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
      await startBackend();
      buildMenu();
      createWindow();
      setupAutoUpdates();
    } catch (err) {
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
