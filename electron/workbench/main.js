import { app, BrowserWindow, dialog, Menu, Notification, nativeImage, shell, Tray } from 'electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixPath } from './pathFix.js';
import { ServerProcess } from './serverProcess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'Workbench';
const isMac = process.platform === 'darwin';

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('local.workbench.desktop');

let mainWindow = null;
let tray = null;
let server = null;
let sessionCount = 0;
let isQuitting = false;

const appRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..', '..');
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    fs.writeFileSync(statePath(), JSON.stringify({ ...bounds, maximized: mainWindow.isMaximized() }));
  } catch {
    // Non-fatal: window state is a convenience.
  }
}

function iconPath() {
  return path.join(appRoot, 'electron', 'assets', isMac ? 'logo-macos.png' : 'logo-windows.ico');
}

function findMissingClis() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return ['claude', 'codex'].filter((name) => {
    const result = spawnSync(finder, [name], { windowsHide: true });
    return result.status !== 0;
  });
}

function showMissingCliNotice(missing) {
  const help = {
    claude: 'Claude Code: https://docs.claude.com/en/docs/claude-code/setup',
    codex: 'Codex CLI: npm install -g @openai/codex',
  };
  dialog.showMessageBox({
    type: 'warning',
    title: `${APP_NAME}: CLI not found`,
    message: `Could not find on PATH: ${missing.join(', ')}`,
    detail: `${missing.map((name) => help[name]).join('\n')}\n\nInstall and log in from a terminal, then restart ${APP_NAME}. The other CLI keeps working.`,
  });
}

function createWindow(url) {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width ?? 1400,
    height: state.height ?? 900,
    x: state.x,
    y: state.y,
    title: APP_NAME,
    icon: iconPath(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (state.maximized) mainWindow.maximize();
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.on('close', (event) => {
    saveWindowState();
    if (!isQuitting && isMac) {
      // macOS convention: closing the last window keeps the app running.
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(process.env.WORKBENCH_DEV_URL || url);
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** OS notification when a worktree session needs input or finishes; click focuses that session. */
function notifySessionStatus({ sessionId, title, status }) {
  if (!Notification.isSupported()) return;
  if (mainWindow && mainWindow.isFocused()) return;
  const bodies = {
    waiting: 'Needs your input',
    done: 'Finished',
    error: 'Ended with an error',
  };
  const notification = new Notification({ title: title || APP_NAME, body: bodies[status] ?? status, silent: false });
  notification.on('click', () => {
    showWindow();
    mainWindow?.webContents
      .executeJavaScript(`window.dispatchEvent(new CustomEvent('workbench:select-session', { detail: ${JSON.stringify(sessionId)} }))`)
      .catch(() => undefined);
  });
  try {
    notification.show();
  } catch {
    // Permission denied or no notification service: ignore, the in-app badge still shows status.
  }
}

function buildTrayImage() {
  // 32x32 monochrome ring; a template image on macOS so it adapts to the menu bar.
  const size = 32;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - 15.5, y - 15.5);
      const filled = distance <= 13 && distance >= 8;
      buffer[(y * size + x) * 4 + 3] = filled ? 255 : 0;
    }
  }
  const image = nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor: 2 });
  if (isMac) image.setTemplateImage(true);
  return image;
}

function refreshTray() {
  if (!tray) return;
  const loginItem = app.getLoginItemSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open ${APP_NAME}`, click: showWindow },
    { label: `Active sessions: ${sessionCount}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Start with system',
      type: 'checkbox',
      checked: loginItem.openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        refreshTray();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.setToolTip(`${APP_NAME} (${sessionCount} active)`);
}

function buildAppMenu() {
  // The Edit menu is required on macOS for Cmd+C / Cmd+V / Cmd+A to work.
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    await fixPath();
    buildAppMenu();

    server = new ServerProcess({
      appRoot,
      onSessionStatus: notifySessionStatus,
      onSessionCount: (count) => {
        if (count !== sessionCount) {
          sessionCount = count;
          refreshTray();
        }
      },
    });

    let url;
    try {
      url = await server.start();
    } catch (error) {
      dialog.showErrorBox(`${APP_NAME} failed to start`, String(error.message || error));
      isQuitting = true;
      app.quit();
      return;
    }

    createWindow(url);
    tray = new Tray(buildTrayImage());
    tray.on('click', showWindow);
    refreshTray();

    const missing = findMissingClis();
    if (missing.length) showMissingCliNotice(missing);

    app.on('activate', () => {
      if (!mainWindow) createWindow(server.url);
      else showWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });

  app.on('before-quit', (event) => {
    if (isQuitting) return;
    isQuitting = true;
    if (server) {
      event.preventDefault();
      server.stop().finally(() => app.quit());
    }
  });

  process.on('exit', () => server?.killNow());
}
