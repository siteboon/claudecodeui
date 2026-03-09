import { app, BrowserWindow, dialog, shell } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let serverPort = null;
const isElectronDev = process.env.CLAUDE_CODE_UI_ELECTRON_DEV === 'true';

// Find an available TCP port starting from the given port
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

async function findAvailablePort(startPort = 3001) {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error('No available port found in range ' + startPort + '-' + (startPort + 99));
}

async function resolveServerPort(startPort = 3001) {
  const requestedPort = Number.parseInt(process.env.PORT || '', 10);

  if (Number.isInteger(requestedPort)) {
    const available = await isPortAvailable(requestedPort);
    if (!available) {
      throw new Error(`Requested backend port ${requestedPort} is unavailable`);
    }
    return requestedPort;
  }

  return findAvailablePort(startPort);
}

async function startEmbeddedServer(port) {
  // Set env vars before importing the server module (they are read at module level)
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';

  const { startServer } = await import('../server/index.js');
  await startServer();
  return port;
}

function createWindow(port) {
  const iconPath = path.join(__dirname, '../build/icons/icon.png');
  const rendererUrl = isElectronDev
    ? (process.env.CLAUDE_CODE_UI_VITE_URL || `http://127.0.0.1:${process.env.VITE_PORT || 5173}`)
    : `http://127.0.0.1:${port}`;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      additionalArguments: [`--cloudcli-server-port=${port}`],
    },
    icon: iconPath,
    show: false,
    title: 'Claude Code UI',
    backgroundColor: '#0f0f0f',
  });

  mainWindow.loadURL(rendererUrl);

  // Show window once the page is ready to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the system browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    serverPort = await resolveServerPort(3001);
    await startEmbeddedServer(serverPort);
    createWindow(serverPort);
  } catch (error) {
    console.error('[Electron] Failed to start:', error);
    dialog.showErrorBox(
      '启动失败 / Startup Failed',
      `无法启动后端服务：\n${error.message}\n\nFailed to start backend server:\n${error.message}`
    );
    app.quit();
    return;
  }

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
      createWindow(serverPort);
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
