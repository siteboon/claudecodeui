import { BrowserView, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, session } from 'electron';

const TITLEBAR_HEIGHT = 44;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPlaceholderHtml(title, message, logs = []) {
  const logHtml = logs.length
    ? `<pre>${logs.map(escapeHtml).join('\n')}</pre>`
    : '<pre>Waiting for process output...</pre>';
  return [
    '<!doctype html><meta charset="utf-8">',
    '<style>',
    'html,body{margin:0;height:100%;background:#0a0a0a;color:#fafafa;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    'body{padding:28px;overflow:hidden}',
    '.shell{height:100%;display:flex;flex-direction:column;gap:16px}',
    '.box{display:flex;align-items:center;gap:10px;color:#d4d4d4;flex:0 0 auto}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#0b60ea;box-shadow:0 0 0 6px rgba(11,96,234,.15)}',
    'pre{margin:0;flex:1;overflow:auto;border:1px solid #262626;border-radius:10px;background:#050505;color:#d4d4d4;padding:14px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap;user-select:text}',
    '</style>',
    '<div class="shell">',
    `<div class="box"><span class="dot"></span><span>${escapeHtml(message || `Opening ${title}...`)}</span></div>`,
    logHtml,
    '</div>',
  ].join('');
}

export class DesktopWindowManager {
  constructor({
    appName,
    getWindowIconPath,
    getLauncherPath,
    getPreloadPath,
    openExternalUrl,
    getDesktopState,
    getDisplayTargetName,
    getRemoteEnvironmentMenuItems,
    getCloudState,
    getLocalState,
    actions,
    tabs,
  }) {
    this.appName = appName;
    this.getWindowIconPath = getWindowIconPath;
    this.getLauncherPath = getLauncherPath;
    this.getPreloadPath = getPreloadPath;
    this.openExternalUrl = openExternalUrl;
    this.getDesktopState = getDesktopState;
    this.getDisplayTargetName = getDisplayTargetName;
    this.getRemoteEnvironmentMenuItems = getRemoteEnvironmentMenuItems;
    this.getCloudState = getCloudState;
    this.getLocalState = getLocalState;
    this.actions = actions;
    this.tabs = tabs;

    this.mainWindow = null;
    this.tray = null;
    this.launcherLoaded = false;
    this.activeContentView = null;
    this.tabViews = new Map();
  }

  getMainWindow() {
    return this.mainWindow;
  }

  getTrayImage() {
    const image = nativeImage.createFromPath(this.getWindowIconPath());
    return image.resize({ width: 18, height: 18 });
  }

  getContentViewBounds() {
    if (!this.mainWindow) return { x: 0, y: TITLEBAR_HEIGHT, width: 0, height: 0 };
    const [width, height] = this.mainWindow.getContentSize();
    return {
      x: 0,
      y: TITLEBAR_HEIGHT,
      width,
      height: Math.max(0, height - TITLEBAR_HEIGHT),
    };
  }

  configureChildWebContents(webContents) {
    webContents.setWindowOpenHandler(({ url }) => {
      void this.openExternalUrl(url).catch((error) => this.actions.showError('Could not open external link', error));
      return { action: 'deny' };
    });
  }

  detachActiveContentView() {
    if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.activeContentView) return;
    try {
      if (this.mainWindow.getBrowserViews().includes(this.activeContentView)) {
        this.mainWindow.removeBrowserView(this.activeContentView);
      }
    } catch {
      // BrowserViews may already be gone during BrowserWindow teardown.
    }
    this.activeContentView = null;
  }

  getOrCreateTabView(tabId) {
    let view = this.tabViews.get(tabId);
    if (view) return view;

    view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.getPreloadPath(),
      },
    });
    this.configureChildWebContents(view.webContents);
    this.tabViews.set(tabId, view);
    return view;
  }

  attachContentView(view) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (this.activeContentView && this.activeContentView !== view) {
      this.detachActiveContentView();
    }
    this.activeContentView = view;
    try {
      if (!this.mainWindow.getBrowserViews().includes(view)) {
        this.mainWindow.addBrowserView(view);
      }
    } catch {
      return;
    }
    view.setBounds(this.getContentViewBounds());
    view.setAutoResize({ width: true, height: true });
  }

  async showTabPlaceholder(target, message) {
    const tabId = this.tabs.getTabIdForTarget(target);
    const view = this.getOrCreateTabView(tabId);
    this.attachContentView(view);
    const html = buildPlaceholderHtml(target.name || this.appName, message);
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    view.__cloudcliStartupHtml = html;
    view.__cloudcliLoadedUrl = null;
  }

  async showLocalStartupTarget(target, logs) {
    const tabId = this.tabs.getTabIdForTarget(target);
    const view = this.getOrCreateTabView(tabId);
    if (view.__cloudcliLoadingUrl) return;
    this.attachContentView(view);
    const html = buildPlaceholderHtml(target.name || this.appName, 'Starting Local CloudCLI...', logs);
    if (view.__cloudcliStartupHtml === html) return;
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    view.__cloudcliStartupHtml = html;
    view.__cloudcliLoadedUrl = null;
  }

  async showContentTarget(target) {
    const tabId = this.tabs.getTabIdForTarget(target);
    const view = this.getOrCreateTabView(tabId);
    this.attachContentView(view);
    if (view.__cloudcliLoadedUrl !== target.url) {
      view.__cloudcliLoadingUrl = target.url;
      try {
        await view.webContents.loadURL(target.url);
        view.__cloudcliLoadedUrl = target.url;
        view.__cloudcliStartupHtml = null;
      } finally {
        if (view.__cloudcliLoadingUrl === target.url) {
          view.__cloudcliLoadingUrl = null;
        }
      }
    }
  }

  destroyTabView(tabId) {
    const view = this.tabViews.get(tabId);
    if (!view) return;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        if (this.mainWindow.getBrowserViews().includes(view)) {
          this.mainWindow.removeBrowserView(view);
        }
      } catch {
        // Ignore teardown races; Electron owns final destruction during quit.
      }
    }
    if (this.activeContentView === view) {
      this.activeContentView = null;
    }
    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.destroy();
      }
    } catch {
      // The view may already be destroyed by its parent BrowserWindow.
    }
    this.tabViews.delete(tabId);
  }

  emitDesktopState() {
    if (!this.mainWindow || this.mainWindow.webContents.isDestroyed()) return;
    this.mainWindow.webContents.send('cloudcli-desktop:state-updated', this.getDesktopState());
  }

  emitLauncherCommand(command) {
    if (!this.mainWindow || this.mainWindow.webContents.isDestroyed()) return;
    this.mainWindow.webContents.send('cloudcli-desktop:launcher-command', command);
  }

  async showTarget(target, { trackTab = true } = {}) {
    if (!this.mainWindow) return;
    if (trackTab) {
      this.tabs.upsertTarget(target);
    }
    this.actions.setActiveTarget(target);
    this.buildAppMenu();
    this.mainWindow.setTitle(`${this.appName} - ${target.name}`);
    await this.showContentTarget(target);
    this.emitDesktopState();
  }

  async showLauncher() {
    if (!this.mainWindow) return;
    const target = { kind: 'launcher', name: this.appName, url: null };
    this.tabs.upsertTarget(target);
    this.actions.setActiveTarget(target);
    this.detachActiveContentView();
    this.buildAppMenu();
    this.mainWindow.setTitle(this.appName);
    if (!this.launcherLoaded) {
      await this.mainWindow.loadFile(this.getLauncherPath());
      this.launcherLoaded = true;
    } else {
      this.emitDesktopState();
    }
  }

  async switchDesktopTab(tabId) {
    const tab = this.tabs.activate(tabId);
    if (!tab || !this.mainWindow) return this.getDesktopState();

    if (tab.id === 'home' || tab.kind === 'launcher') {
      await this.showLauncher();
      return this.getDesktopState();
    }

    if (!tab.target?.url) {
      throw new Error('This tab does not have a target URL.');
    }

    await this.showTarget(tab.target, { trackTab: false });
    return this.getDesktopState();
  }

  async closeDesktopTab(tabId) {
    const tab = this.tabs.remove(tabId);
    if (!tab) return this.getDesktopState();
    this.destroyTabView(tabId);
    if (this.tabs.activeTabId === 'home') {
      await this.showLauncher();
    } else {
      this.emitDesktopState();
    }
    return this.getDesktopState();
  }

  buildEnvironmentActionsSubmenu(environment) {
    const items = [];
    const statusSuffix = environment.status === 'running' ? '' : ` (${environment.status})`;
    items.push({
      label: 'Open Environment',
      click: () => void this.actions.openEnvironmentInDesktop(environment)
        .catch((error) => this.actions.showError(`Could not open ${environment.name || environment.subdomain}${statusSuffix}`, error)),
    });
    items.push({
      label: 'Open in Browser',
      click: () => void this.actions.openEnvironmentInBrowser(environment)
        .catch((error) => this.actions.showError('Could not open environment in browser', error)),
    });
    items.push({
      label: 'Open in VS Code',
      click: () => void this.actions.openEnvironmentInIde(environment, 'vscode')
        .catch((error) => this.actions.showError('Could not open environment in VS Code', error)),
    });
    items.push({
      label: 'Open in Cursor',
      click: () => void this.actions.openEnvironmentInIde(environment, 'cursor')
        .catch((error) => this.actions.showError('Could not open environment in Cursor', error)),
    });
    items.push({
      label: 'Open SSH Terminal',
      click: () => void this.actions.openEnvironmentInSsh(environment)
        .catch((error) => this.actions.showError('Could not open SSH terminal', error)),
    });
    items.push({
      label: 'Copy Mobile/Web URL',
      click: () => this.actions.copyText(this.actions.getEnvironmentUrl(environment)),
    });
    if (environment.status !== 'running') {
      items.unshift({
        label: environment.status === 'paused' ? 'Resume' : 'Start',
        click: () => void this.actions.startEnvironment(environment)
          .catch((error) => this.actions.showError('Could not start environment', error)),
      });
    }
    if (environment.status === 'running') {
      items.push({
        label: 'Stop',
        click: () => void this.actions.stopEnvironment(environment)
          .catch((error) => this.actions.showError('Could not stop environment', error)),
      });
    }
    return items;
  }

  buildTrayEnvironmentSection() {
    const cloudState = this.getCloudState();
    if (!cloudState.account?.apiKey) {
      return [
        {
          label: cloudState.account?.email ? `Reconnect ${cloudState.account.email}` : 'Login',
          click: () => void this.actions.connectCloudAccount()
            .catch((error) => this.actions.showError('Could not connect CloudCLI account', error)),
        },
      ];
    }

    if (!cloudState.environments.length) {
      return [{ label: 'No environments found', enabled: false }];
    }

    return cloudState.environments.map((environment) => ({
      label: `${environment.name || environment.subdomain} - ${environment.status}`,
      submenu: this.buildEnvironmentActionsSubmenu(environment),
    }));
  }

  buildAppMenu() {
    if (!this.mainWindow) return;
    const cloudState = this.getCloudState();
    const localState = this.getLocalState();
    const remoteItems = this.getRemoteEnvironmentMenuItems();
    const cloudAccountLabel = cloudState.account?.apiKey
      ? (cloudState.account?.email ? `Connected: ${cloudState.account.email}` : 'CloudCLI Connected')
      : (cloudState.account?.email ? `Reconnect: ${cloudState.account.email}` : 'Connect CloudCLI Account...');

    const template = [
      {
        label: this.appName,
        submenu: [
          { label: `About ${this.appName}`, role: 'about' },
          { type: 'separator' },
          {
            label: 'Show Launcher',
            accelerator: 'CmdOrCtrl+Shift+L',
            click: () => void this.showLauncher().catch((error) => this.actions.showError('Could not show launcher', error)),
          },
          {
            label: 'Switch Environment',
            accelerator: 'CmdOrCtrl+Shift+E',
            click: () => void this.actions.showEnvironmentPicker().catch((error) => this.actions.showError('Could not switch environment', error)),
          },
          { type: 'separator' },
          {
            label: 'Services',
            submenu: [
              {
                label: 'Computer Access',
                click: () => void this.actions.showComputerAccess(),
              },
            ],
          },
          {
            label: 'Diagnostics',
            submenu: [
              {
                label: 'Copy Diagnostics',
                click: () => void this.actions.copyDiagnostics(),
              },
            ],
          },
          { type: 'separator' },
          {
            label: process.platform === 'darwin' ? `Hide ${this.appName}` : 'Hide',
            role: 'hide',
            visible: process.platform === 'darwin',
          },
          { label: 'Hide Others', role: 'hideOthers', visible: process.platform === 'darwin' },
          { label: 'Show All', role: 'unhide', visible: process.platform === 'darwin' },
          { type: 'separator', visible: process.platform === 'darwin' },
          { label: `Quit ${this.appName}`, accelerator: 'CmdOrCtrl+Q', role: 'quit' },
        ],
      },
      {
        label: 'Environment',
        submenu: [
          {
            label: 'Show Launcher',
            accelerator: 'CmdOrCtrl+Shift+L',
            click: () => void this.showLauncher().catch((error) => this.actions.showError('Could not show launcher', error)),
          },
          {
            label: 'Switch Environment',
            accelerator: 'CmdOrCtrl+Shift+E',
            click: () => void this.actions.showEnvironmentPicker().catch((error) => this.actions.showError('Could not switch environment', error)),
          },
          { type: 'separator' },
          {
            label: 'Open Local CloudCLI',
            accelerator: 'CmdOrCtrl+L',
            click: () => void this.actions.openLocalInDesktop().catch((error) => this.actions.showError('Could not open local CloudCLI', error)),
          },
          {
            label: 'Open Local Web UI in Browser',
            accelerator: 'CmdOrCtrl+Shift+W',
            click: () => void this.actions.openLocalWebUi().catch((error) => this.actions.showError('Could not open local web UI', error)),
          },
          {
            label: 'Copy Local Web URL',
            accelerator: 'CmdOrCtrl+Shift+U',
            click: () => void this.actions.copyLocalWebUrl().catch((error) => this.actions.showError('Could not copy local web URL', error)),
          },
          { type: 'separator' },
          {
            label: 'Keep Local Server Running After Quit',
            type: 'checkbox',
            checked: localState.desktopSettings.keepLocalServerRunning,
            click: (menuItem) => void this.actions.updateDesktopSetting('keepLocalServerRunning', menuItem.checked)
              .catch((error) => this.actions.showError('Could not update desktop setting', error)),
          },
          {
            label: 'Allow LAN Access to Local Server',
            type: 'checkbox',
            checked: localState.desktopSettings.exposeLocalServerOnNetwork,
            click: (menuItem) => void this.actions.updateDesktopSetting('exposeLocalServerOnNetwork', menuItem.checked)
              .catch((error) => this.actions.showError('Could not update desktop setting', error)),
          },
        ],
      },
      {
        label: 'Cloud',
        submenu: [
          {
            label: cloudAccountLabel,
            accelerator: 'CmdOrCtrl+Shift+C',
            click: () => void this.actions.connectCloudAccount().catch((error) => this.actions.showError('Could not connect CloudCLI account', error)),
          },
          {
            label: 'Refresh Cloud Environments',
            click: () => void this.actions.refreshCloudEnvironments().catch((error) => this.actions.showError('Could not load CloudCLI environments', error)),
            enabled: Boolean(cloudState.account?.apiKey),
          },
          {
            label: 'Disconnect Cloud Account',
            click: () => void this.actions.clearCloudAccount().catch((error) => this.actions.showError('Could not disconnect cloud account', error)),
            enabled: Boolean(cloudState.account?.apiKey),
          },
          { type: 'separator' },
          {
            label: 'Remote Environments',
            submenu: remoteItems,
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          ...(process.platform === 'darwin' ? [{ type: 'separator' }, { role: 'front' }] : []),
        ],
      },
      {
        label: 'Help',
        submenu: [
        {
          label: 'Open cloudcli.ai',
          click: () => void this.actions.openCloudDashboard(),
        },
          {
            label: 'Copy Diagnostics',
            click: () => void this.actions.copyDiagnostics(),
          },
        ],
      },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    this.buildTrayMenu();
  }

  buildTrayMenu() {
    if (!this.tray) return;
    const cloudState = this.getCloudState();
    const localState = this.getLocalState();

    const template = [
      {
        label: 'Local',
        submenu: [
          {
            label: localState.localServerRunning ? 'Open Local in CloudCLI' : 'Start Local in CloudCLI',
            click: () => void this.actions.openLocalInDesktop().catch((error) => this.actions.showError('Could not open local CloudCLI', error)),
          },
          {
            label: 'Open Local in Browser',
            click: () => void this.actions.openLocalWebUi().catch((error) => this.actions.showError('Could not open local web UI', error)),
          },
          {
            label: 'Copy Local URL',
            click: () => void this.actions.copyLocalWebUrl().catch((error) => this.actions.showError('Could not copy local web URL', error)),
          },
        ],
      },
      {
        label: 'Cloud Environments',
        submenu: this.buildTrayEnvironmentSection(),
      },
      { type: 'separator' },
      {
        label: cloudState.account?.email ? `Connected: ${cloudState.account.email}` : 'Login',
        click: () => void this.actions.connectCloudAccount().catch((error) => this.actions.showError('Could not connect CloudCLI account', error)),
      },
      {
        label: 'Disconnect Cloud Account',
        click: () => void this.actions.clearCloudAccount().catch((error) => this.actions.showError('Could not disconnect cloud account', error)),
        enabled: Boolean(cloudState.account?.apiKey),
      },
      { type: 'separator' },
      {
        label: `Quit ${this.appName}`,
        role: 'quit',
      },
    ];

    this.tray.setToolTip(`${this.appName}${this.actions.getActiveTarget()?.name ? ` - ${this.actions.getActiveTarget().name}` : ''}`);
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  async showDesktopSettings() {
    if (!this.mainWindow) return this.getDesktopState();
    await this.showLauncher();
    this.emitLauncherCommand({ type: 'open-sheet', sheet: 'app-settings' });
    return this.getDesktopState();
  }

  async showActiveEnvironmentActionsMenu() {
    if (!this.mainWindow) return this.getDesktopState();
    const activeTarget = this.actions.getActiveTarget();
    if (activeTarget?.kind !== 'remote') return this.getDesktopState();

    const environment = this.getCloudState().environments.find((item) => item.id === activeTarget.id);
    if (!environment) return this.getDesktopState();

    const menu = Menu.buildFromTemplate(this.buildEnvironmentActionsSubmenu(environment));
    menu.popup({ window: this.mainWindow });
    return this.getDesktopState();
  }

  async showEnvironmentActionsMenu(environmentId) {
    if (!this.mainWindow) return this.getDesktopState();
    const environment = this.getCloudState().environments.find((item) => item.id === environmentId);
    if (!environment) return this.getDesktopState();

    const menu = Menu.buildFromTemplate(this.buildEnvironmentActionsSubmenu(environment));
    menu.popup({ window: this.mainWindow });
    return this.getDesktopState();
  }

  configurePermissions() {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const sourceUrl = webContents.getURL();
      const isCloudCliOrigin = sourceUrl.startsWith('http://127.0.0.1:')
        || sourceUrl.startsWith(this.getCloudState().controlPlaneUrl)
        || /^https:\/\/[a-z0-9-]+\.cloudcli\.ai/i.test(sourceUrl);
      const allowedPermissions = new Set(['clipboard-read', 'media']);
      callback(isCloudCliOrigin && allowedPermissions.has(permission));
    });
  }

  createTray() {
    if (this.tray) return;
    this.tray = new Tray(this.getTrayImage());
    this.tray.on('click', () => {
      if (!this.mainWindow) return;
      if (this.mainWindow.isVisible()) {
        this.mainWindow.focus();
      } else {
        this.mainWindow.show();
      }
    });
    this.buildTrayMenu();
  }

  async createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 1024,
      minHeight: 720,
      show: false,
      backgroundColor: '#0f172a',
      title: this.appName,
      icon: this.getWindowIconPath(),
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 18, y: 14 } }
        : {
            titleBarOverlay: {
              color: nativeTheme.shouldUseDarkColors ? '#111111' : '#f7f8fa',
              symbolColor: nativeTheme.shouldUseDarkColors ? '#a1a1a1' : '#5b6470',
              height: 44,
            },
          }),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.getPreloadPath(),
      },
    });

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      void this.openExternalUrl(url).catch((error) => this.actions.showError('Could not open external link', error));
      return { action: 'deny' };
    });

    this.mainWindow.on('resize', () => {
      if (this.activeContentView) {
        this.activeContentView.setBounds(this.getContentViewBounds());
      }
    });

    this.mainWindow.on('closed', () => {
      this.tabViews.clear();
      this.activeContentView = null;
      this.mainWindow = null;
      this.launcherLoaded = false;
    });

    this.buildAppMenu();
    await this.showLauncher();
  }
}
