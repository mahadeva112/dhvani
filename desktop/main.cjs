const path = require('node:path');
const fs = require('node:fs');
const { fork } = require('node:child_process');
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');

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

const logFile = path.join(app.getPath('userData'), 'backend.log');

const appendLog = (line) => {
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // Logging must never take the app down.
  }
};

/** Starts the Express backend as a child Node process. */
const startBackend = () =>
  new Promise((resolve, reject) => {
    const serverEntry = path.join(APP_ROOT, 'server', 'index.js');

    if (!fs.existsSync(serverEntry)) {
      reject(new Error(`Backend not found at ${serverEntry}`));
      return;
    }

    backend = fork(serverEntry, [], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
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
