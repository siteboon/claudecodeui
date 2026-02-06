import { app, BrowserWindow, shell, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';
const PORT = 37429;
const DEV_PORT = 5173;

// In production, redirect the database to Electron's userData directory
// so it is not written inside the read-only asar archive.
if (!isDev && !process.env.DATABASE_PATH) {
  const userDataPath = app.getPath('userData');
  process.env.DATABASE_PATH = join(userDataPath, 'auth.db');
}

let mainWindow = null;

/**
 * Poll an HTTP URL until it responds with a 2xx status or the timeout expires.
 * @param {string} url - The URL to poll.
 * @param {number} [timeout=30000] - Maximum time in ms to wait.
 * @returns {Promise<void>}
 */
function waitForServer(url, timeout = 30000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
        } else {
          retry();
        }
        // Consume response data to free up memory
        res.resume();
      });

      req.on('error', () => {
        retry();
      });

      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - start >= timeout) {
        reject(new Error(`Server at ${url} did not respond within ${timeout}ms`));
        return;
      }
      setTimeout(attempt, 200);
    };

    attempt();
  });
}

/**
 * Create the main application window.
 */
function createWindow(serverUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    icon: join(__dirname, '..', 'public', 'icons', 'icon-512x512.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: process.platform === 'darwin' ? { x: 15, y: 10 } : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.js'),
    },
  });

  // Show window once the page has finished loading
  mainWindow.once('ready-to-show', () => {
    if (process.platform === 'darwin') {
      // Create drag region element and inject styles from main process
      mainWindow.webContents.executeJavaScript(`
        const bar = document.createElement('div');
        bar.id = 'electron-drag-bar';
        document.body.prepend(bar);
      `);
      mainWindow.webContents.insertCSS(`
        #electron-drag-bar {
          position: fixed;
          top: 0; left: 0; right: 0;
          height: 38px;
          z-index: 9999;
          -webkit-app-region: drag;
          pointer-events: auto;
        }
        .electron-sidebar { padding-top: 38px !important; }
        .pwa-header-safe { padding-top: 38px !important; }
      `);
    }
    mainWindow.show();
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Intercept navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const windowUrl = new URL(serverUrl);
    const targetUrl = new URL(url);
    if (targetUrl.origin !== windowUrl.origin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(serverUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Start the Express server (production only) and launch the window.
 */
async function startApp() {
  try {
    if (isDev) {
      // In development, Vite dev server is expected to be running already
      const devUrl = `http://localhost:${DEV_PORT}`;
      await waitForServer(devUrl, 30000);
      createWindow(devUrl);
    } else {
      // In production, start the Express server
      process.env.PORT = String(PORT);
      await import('../server/index.js');

      const prodUrl = `http://localhost:${PORT}`;
      await waitForServer(prodUrl, 30000);
      createWindow(prodUrl);
    }
  } catch (err) {
    dialog.showErrorBox(
      'Startup Error',
      `Claude Code UI failed to start.\n\n${err.message || err}`
    );
    app.quit();
  }
}

// --- App lifecycle events ---

app.whenReady().then(startApp);

// macOS: keep the app running when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS: recreate window when dock icon is clicked and no windows exist
app.on('activate', () => {
  if (mainWindow === null) {
    const url = isDev
      ? `http://localhost:${DEV_PORT}`
      : `http://localhost:${PORT}`;
    createWindow(url);
  }
});

// Graceful cleanup on quit
app.on('before-quit', () => {
  if (mainWindow) {
    mainWindow.removeAllListeners('close');
    mainWindow.close();
  }
});
