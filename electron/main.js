import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CloudController } from './cloud.js';
import { DesktopWindowManager } from './desktopWindow.js';
import { LocalServerController } from './localServer.js';
import { TabsController } from './tabs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_NAME = 'CloudCLI';
const CALLBACK_PROTOCOL = 'cloudcli';
const CALLBACK_URL = `${CALLBACK_PROTOCOL}://auth/callback`;
const CLOUDCLI_CONTROL_PLANE_URL = process.env.CLOUDCLI_CONTROL_PLANE_URL || 'https://cloudcli.ai';
const REMOTE_START_TIMEOUT_MS = 30000;

const tabs = new TabsController();

let activeTarget = { kind: 'launcher', name: APP_NAME, url: null };
let desktopWindow = null;
let localServer = null;
let cloud = null;
let isQuitting = false;
let isRefreshingCloud = false;

function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
}

function getLauncherPath() {
  return path.join(__dirname, 'launcher', 'index.html');
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.cjs');
}

function getWindowIconPath() {
  if (process.platform === 'darwin') {
    return path.join(getAppRoot(), 'electron', 'assets', 'logo-macos.png');
  }
  return path.join(getAppRoot(), 'public', 'logo-512.png');
}

function getStorePath() {
  return path.join(app.getPath('userData'), 'cloud-account.json');
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function getDisplayTargetName() {
  return activeTarget?.name || APP_NAME;
}

function getCloudState() {
  return {
    account: cloud.getAccount(),
    environments: cloud.getEnvironments(),
    controlPlaneUrl: CLOUDCLI_CONTROL_PLANE_URL,
  };
}

function getLocalState() {
  return {
    desktopSettings: localServer.getSettings(),
    localServerRunning: Boolean(localServer.getLocalServerUrl()),
    localWebUrl: localServer.getLocalServerUrl(),
    shareableWebUrl: localServer.getShareableWebUrl(),
  };
}

function serializeEnvironment(environment) {
  return {
    id: environment.id,
    name: environment.name,
    subdomain: environment.subdomain,
    access_url: cloud.getEnvironmentUrl(environment),
    status: environment.status,
    created_at: environment.created_at,
    github_url: environment.github_url || null,
    region: environment.region || null,
    agent: environment.agent || null,
  };
}

function getDesktopState() {
  const cloudAccount = cloud.getAccount();
  const localState = getLocalState();
  const authState = cloud.getAuthState();
  return {
    account: {
      connected: authState === 'connected',
      email: cloudAccount?.email || null,
      authState,
      requiresReconnect: authState === 'expired',
    },
    activeTarget,
    desktopSettings: localState.desktopSettings,
    localWebUrl: localState.localWebUrl,
    shareableWebUrl: localState.shareableWebUrl,
    localServerRunning: localState.localServerRunning,
    localStartupLogs: localServer.getStartupLogs(),
    cloudLoading: isRefreshingCloud,
    tabs: tabs.getSerializableTabs(),
    activeTabId: tabs.activeTabId,
    environments: cloud.getEnvironments().map(serializeEnvironment),
  };
}

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol)
      || (parsed.protocol === `${CALLBACK_PROTOCOL}:` && parsed.hostname === 'auth');
  } catch {
    return false;
  }
}

async function openExternalUrl(url) {
  if (!isSafeExternalUrl(url)) {
    throw new Error(`Refusing to open unsupported external URL: ${url}`);
  }

  if (url.startsWith(`${CALLBACK_PROTOCOL}://`)) {
    await handleDeepLink(url);
    return;
  }

  await shell.openExternal(url);
}

async function showError(title, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${title}: ${message}`);
  await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'error',
    title,
    message: title,
    detail: message,
  });
}

function isExpectedNavigationAbort(error) {
  const message = error instanceof Error ? error.message : String(error);
  return error?.code === 'ERR_ABORTED' || message.includes('ERR_ABORTED') || message.includes('(-3)');
}

function syncDesktopState() {
  if (!desktopWindow) return;
  desktopWindow.buildAppMenu();
  desktopWindow.emitDesktopState();
  if (activeTarget?.kind === 'local' && !localServer?.getLocalServerUrl()) {
    void desktopWindow.showLocalStartupTarget(localServer.getPendingTarget(), localServer.getStartupLogs())
      .catch((error) => {
        if (isExpectedNavigationAbort(error)) return;
        void showError('Could not update local startup log', error);
      });
  }
}

function setActiveTarget(target) {
  activeTarget = target;
}

function getEnvironmentTarget(environment) {
  return {
    kind: 'remote',
    id: environment.id,
    name: environment.name || environment.subdomain,
    url: cloud.getEnvironmentUrl(environment),
  };
}

async function getEnvironmentLaunchTarget(environment) {
  return {
    ...getEnvironmentTarget(environment),
    url: await cloud.getEnvironmentLaunchUrl(environment),
  };
}

function getDiagnosticsText() {
  const cloudAccount = cloud.getAccount();
  const localState = getLocalState();
  return JSON.stringify({
    app: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    appPath: getAppRoot(),
    userDataPath: app.getPath('userData'),
    activeTarget,
    localServerUrl: localState.localWebUrl,
    localServerPort: localServer.localServerPort,
    localWebUrl: localState.localWebUrl,
    shareableWebUrl: localState.shareableWebUrl,
    desktopSettings: localState.desktopSettings,
    cloudConnected: Boolean(cloudAccount?.apiKey),
    cloudEmail: cloudAccount?.email || null,
    cloudEnvironmentCount: cloud.getEnvironments().length,
    controlPlaneUrl: CLOUDCLI_CONTROL_PLANE_URL,
  }, null, 2);
}

async function copyDiagnostics() {
  clipboard.writeText(getDiagnosticsText());
  await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'info',
    title: 'Diagnostics copied',
    message: 'CloudCLI desktop diagnostics were copied to the clipboard.',
  });
}

async function showComputerUsePreview() {
  await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'info',
    buttons: ['OK'],
    title: 'Computer Use Preview',
    message: 'Computer use needs an explicit safety gate before it can run.',
    detail: [
      'The desktop shell is ready for controlled automation hooks, but full computer use is not enabled yet.',
      '',
      'Before this is exposed, CloudCLI needs per-session consent, a stop control, screen-capture permission checks, app/window scoping, and a provider-specific action loop.',
    ].join('\n'),
  });
}

async function refreshCloudEnvironments({ showErrors = false } = {}) {
  isRefreshingCloud = true;
  syncDesktopState();
  try {
    return await cloud.refreshCloudEnvironments();
  } catch (error) {
    const authState = cloud.getAuthState();
    if (authState === 'expired') {
      const expiredError = new Error('Your CloudCLI session expired. Reconnect your account.');
      if (showErrors) {
        await showError('CloudCLI login required', expiredError);
        return [];
      }
      throw expiredError;
    }
    if (showErrors) {
      await showError('Could not load CloudCLI environments', error);
      return [];
    }
    throw error;
  } finally {
    isRefreshingCloud = false;
    syncDesktopState();
  }
}

async function connectCloudAccount() {
  const connectUrl = cloud.buildConnectUrl();
  clipboard.writeText(connectUrl);
  await openExternalUrl(connectUrl);
  return connectUrl;
}

async function handleDeepLink(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  if (parsed.protocol !== `${CALLBACK_PROTOCOL}:` || parsed.hostname !== 'auth') {
    return;
  }

  const apiKey = parsed.searchParams.get('api_key');
  if (!apiKey) {
    await showError('CloudCLI account connection failed', new Error('The callback did not include an API key.'));
    return;
  }

  await cloud.saveFromCallback({
    apiKey,
    email: parsed.searchParams.get('email'),
  });
  await refreshCloudEnvironments({ showErrors: true });

  dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'info',
    title: 'CloudCLI account connected',
    message: cloud.getAccount()?.email ? `Connected as ${cloud.getAccount().email}.` : 'CloudCLI account connected.',
  }).catch(() => {});
}

async function copyLocalWebUrl() {
  await localServer.ensureLocalServer();
  const shareableUrl = localServer.getShareableWebUrl();
  const localUrl = localServer.getLocalServerUrl();

  if (!shareableUrl) {
    throw new Error('Local CloudCLI URL is not available yet.');
  }

  clipboard.writeText(shareableUrl);
  const isLanUrl = shareableUrl !== localUrl;
  await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'info',
    title: 'Web URL copied',
    message: isLanUrl ? 'LAN web URL copied.' : 'Local web URL copied.',
    detail: isLanUrl
      ? `${shareableUrl}\n\nUse this URL from another device on the same network.`
      : `${shareableUrl}\n\nThis URL works on this computer. Enable LAN access before starting Local CloudCLI to copy a phone-accessible URL.`,
  });

  return getDesktopState();
}

async function openLocalWebUi() {
  await localServer.ensureLocalServer();
  const url = localServer.getShareableWebUrl() || localServer.getLocalServerUrl();
  if (!url) {
    throw new Error('Local CloudCLI URL is not available yet.');
  }

  await shell.openExternal(url);
  return getDesktopState();
}

async function updateDesktopSetting(key, value) {
  const result = await localServer.updateDesktopSetting(key, value);
  syncDesktopState();

  if (result.requiresRestartNotice) {
    await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
      type: 'info',
      title: 'Restart local server to apply',
      message: 'LAN access changes apply the next time the local server starts.',
      detail: 'Quit CloudCLI and stop the local server, then open Local CloudCLI again.',
    });
  }

  return getDesktopState();
}

async function showEnvironmentPicker() {
  const environments = await refreshCloudEnvironments({ showErrors: true });
  const choices = ['Local CloudCLI', ...environments.map((environment) => {
    const status = environment.status === 'running' ? '' : ` (${environment.status})`;
    return `${environment.name || environment.subdomain}${status}`;
  })];

  const response = await dialog.showMessageBox(desktopWindow?.getMainWindow(), {
    type: 'question',
    buttons: [...choices, 'Cancel'],
    defaultId: 0,
    cancelId: choices.length,
    title: 'Switch CloudCLI Environment',
    message: 'Choose where this desktop window should connect.',
  });

  if (response.response === choices.length) return getDesktopState();
  if (response.response === 0) return openLocalInDesktop();
  return openEnvironmentInDesktop(environments[response.response - 1]);
}

async function startEnvironment(environment) {
  await cloud.startEnvironmentAndWait(environment, REMOTE_START_TIMEOUT_MS);
  await refreshCloudEnvironments({ showErrors: true });
  return getDesktopState();
}

async function stopEnvironment(environment) {
  await cloud.stopEnvironment(environment);
  await refreshCloudEnvironments({ showErrors: true });
  return getDesktopState();
}

async function openEnvironmentInBrowser(environment) {
  await shell.openExternal(await cloud.getEnvironmentLaunchUrl(environment));
  return getDesktopState();
}

function getProjectFolder(environment) {
  return String(environment.name || environment.subdomain || 'workspace').replace(/[^a-zA-Z0-9-]/g, '');
}

function getSshTarget(credentials) {
  if (credentials.ssh_command) {
    const parts = String(credentials.ssh_command).split(/\s+/);
    if (parts.length >= 2) return parts[1];
  }
  return `${credentials.username}@ssh.cloudcli.ai`;
}

function getSshHost(credentials) {
  const target = getSshTarget(credentials);
  const atIndex = target.indexOf('@');
  return atIndex >= 0 ? target.slice(atIndex + 1) : 'ssh.cloudcli.ai';
}

async function getEnvironmentCredentials(environment) {
  const credentials = await cloud.getEnvironmentCredentials(environment);
  if (credentials.password) {
    clipboard.writeText(credentials.password);
  }
  return credentials;
}

async function openEnvironmentInIde(environment, ide) {
  const credentials = await getEnvironmentCredentials(environment);
  const scheme = ide === 'cursor' ? 'cursor' : 'vscode';
  const remoteUri = `${scheme}://vscode-remote/ssh-remote+${credentials.username}@${getSshHost(credentials)}/workspace/${getProjectFolder(environment)}?windowId=_blank`;
  await shell.openExternal(remoteUri);
  return getDesktopState();
}

async function openEnvironmentInSsh(environment) {
  const credentials = await getEnvironmentCredentials(environment);
  const sshCommand = `ssh -t ${getSshTarget(credentials)} "cd /workspace/${getProjectFolder(environment)} && exec $SHELL -l"`;

  if (process.platform === 'darwin') {
    const escaped = sshCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    spawn('osascript', ['-e', `tell application "Terminal" to do script "${escaped}"`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    clipboard.writeText(sshCommand);
    await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
      type: 'info',
      title: 'SSH command copied',
      message: 'The SSH command was copied to the clipboard.',
      detail: sshCommand,
    });
  }

  return getDesktopState();
}

async function copyEnvironmentMobileUrl(environment) {
  const url = cloud.getEnvironmentUrl(environment);
  clipboard.writeText(url);
  await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'info',
    title: 'Environment URL copied',
    message: 'Use this URL from your mobile browser.',
    detail: url,
  });
  return getDesktopState();
}

async function openCloudDashboard() {
  await shell.openExternal(CLOUDCLI_CONTROL_PLANE_URL);
  return getDesktopState();
}

function getActiveRemoteEnvironment() {
  if (activeTarget?.kind !== 'remote') return null;
  return cloud.findEnvironment(activeTarget.id);
}

async function runActiveEnvironmentAction(action) {
  const environment = getActiveRemoteEnvironment();
  if (!environment) {
    throw new Error('Open a cloud environment first.');
  }

  switch (action) {
    case 'web':
      return openEnvironmentInBrowser(environment);
    case 'vscode':
      return openEnvironmentInIde(environment, 'vscode');
    case 'cursor':
      return openEnvironmentInIde(environment, 'cursor');
    case 'ssh':
      return openEnvironmentInSsh(environment);
    case 'mobile':
      return copyEnvironmentMobileUrl(environment);
    default:
      throw new Error(`Unknown environment action: ${action}`);
  }
}

async function openLocalInDesktop() {
  const existingTab = tabs.getTab('local');
  if (existingTab && localServer.getLocalServerUrl()) {
    await desktopWindow.showTarget(await localServer.getResolvedTarget());
    return getDesktopState();
  }

  const pendingTarget = localServer.getPendingTarget();
  tabs.upsertTarget(pendingTarget);
  setActiveTarget(pendingTarget);
  await desktopWindow.showLocalStartupTarget(pendingTarget, localServer.getStartupLogs());
  desktopWindow.emitDesktopState();

  const target = await localServer.getResolvedTarget();
  await desktopWindow.showTarget(target);
  return getDesktopState();
}

async function openEnvironmentInDesktop(environment) {
  const pendingTarget = getEnvironmentTarget(environment);
  const tabId = tabs.getTabIdForTarget(pendingTarget);
  const hadTab = Boolean(tabs.getTab(tabId));
  const previousTabId = tabs.activeTabId;

  if (!hadTab) {
    await desktopWindow.showTabPlaceholder(
      pendingTarget,
      `${environment.status === 'running' ? 'Opening' : 'Starting'} ${pendingTarget.name}...`,
    );
    tabs.upsertTarget(pendingTarget);
    desktopWindow.emitDesktopState();
  }

  let nextEnvironment = environment;

  if (environment.status !== 'running') {
    const response = await dialog.showMessageBox(desktopWindow?.getMainWindow(), {
      type: 'question',
      buttons: ['Start Environment', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Start environment?',
      message: `${pendingTarget.name} is ${environment.status}.`,
      detail: 'CloudCLI can start it before opening the remote app.',
    });

    if (response.response !== 0) {
      if (!hadTab) {
        tabs.remove(tabId);
        desktopWindow.destroyTabView(tabId);
        if (previousTabId && previousTabId !== tabId) {
          await desktopWindow.switchDesktopTab(previousTabId);
        } else {
          await desktopWindow.showLauncher();
        }
      }
      return getDesktopState();
    }

    if (hadTab) {
      await desktopWindow.showTabPlaceholder(pendingTarget, `Starting ${pendingTarget.name}...`);
      tabs.upsertTarget(pendingTarget);
      desktopWindow.emitDesktopState();
    }

    nextEnvironment = await cloud.startEnvironmentAndWait(environment, REMOTE_START_TIMEOUT_MS);
  }

  const target = await getEnvironmentLaunchTarget(nextEnvironment);
  await desktopWindow.showTarget(target);
  return getDesktopState();
}

async function clearCloudAccount() {
  await cloud.clearCloudAccount();
  return getDesktopState();
}

function getRemoteEnvironmentMenuItems() {
  const cloudAccount = cloud.getAccount();
  const environments = cloud.getEnvironments();

  if (!cloudAccount?.apiKey) {
    return [{ label: 'Connect CloudCLI Account...', click: () => void connectCloudAccount() }];
  }

  if (!environments.length) {
    return [{ label: 'No environments found', enabled: false }];
  }

  return environments.map((environment) => ({
    label: `${environment.name || environment.subdomain}${environment.status === 'running' ? '' : ` (${environment.status})`}`,
    click: () => void openEnvironmentInDesktop(environment)
      .catch((error) => showError('Could not open environment', error)),
  }));
}

function registerProtocolHandler() {
  const appEntry = path.join(getAppRoot(), 'electron', 'main.js');
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(CALLBACK_PROTOCOL, process.execPath, [appEntry]);
  } else {
    app.setAsDefaultProtocolClient(CALLBACK_PROTOCOL);
  }
}

function registerIpcHandlers() {
  ipcMain.handle('cloudcli-desktop:connect-cloud', async () => ({
    ...getDesktopState(),
    connectUrl: await connectCloudAccount(),
  }));

  ipcMain.handle('cloudcli-desktop:copy-diagnostics', async () => {
    await copyDiagnostics();
    return getDesktopState();
  });

  ipcMain.handle('cloudcli-desktop:copy-local-web-url', async () => copyLocalWebUrl());
  ipcMain.handle('cloudcli-desktop:get-state', () => getDesktopState());
  ipcMain.handle('cloudcli-desktop:open-cloud-dashboard', async () => openCloudDashboard());
  ipcMain.handle('cloudcli-desktop:run-active-environment-action', async (_event, action) => runActiveEnvironmentAction(action));
  ipcMain.handle('cloudcli-desktop:open-environment', async (_event, environmentId) => {
    const environment = cloud.findEnvironment(environmentId);
    if (!environment) {
      throw new Error('Environment not found. Refresh and try again.');
    }
    return openEnvironmentInDesktop(environment);
  });
  ipcMain.handle('cloudcli-desktop:open-local', async () => openLocalInDesktop());
  ipcMain.handle('cloudcli-desktop:open-local-web-ui', async () => openLocalWebUi());
  ipcMain.handle('cloudcli-desktop:refresh-environments', async () => {
    await refreshCloudEnvironments({ showErrors: true });
    return getDesktopState();
  });
  ipcMain.handle('cloudcli-desktop:show-environment-picker', async () => showEnvironmentPicker());
  ipcMain.handle('cloudcli-desktop:show-launcher', async () => {
    await desktopWindow.showLauncher();
    return getDesktopState();
  });
  ipcMain.handle('cloudcli-desktop:show-computer-use-preview', async () => {
    await showComputerUsePreview();
    return getDesktopState();
  });
  ipcMain.handle('cloudcli-desktop:show-desktop-app-menu', async () => desktopWindow.showDesktopAppMenu());
  ipcMain.handle('cloudcli-desktop:show-active-environment-actions-menu', async () => desktopWindow.showActiveEnvironmentActionsMenu());
  ipcMain.handle('cloudcli-desktop:show-environment-actions-menu', async (_event, environmentId) => desktopWindow.showEnvironmentActionsMenu(environmentId));
  ipcMain.handle('cloudcli-desktop:switch-tab', async (_event, tabId) => desktopWindow.switchDesktopTab(tabId));
  ipcMain.handle('cloudcli-desktop:close-tab', async (_event, tabId) => desktopWindow.closeDesktopTab(tabId));
  ipcMain.handle('cloudcli-desktop:update-setting', async (_event, key, value) => updateDesktopSetting(key, value));
}

function registerAppEvents() {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleDeepLink(url);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (desktopWindow) {
        void desktopWindow.createWindow();
      } else {
        void createDesktopWindow();
      }
      return;
    }

    const window = desktopWindow?.getMainWindow();
    if (window) {
      window.show();
      window.focus();
    }
  });

  app.on('before-quit', (event) => {
    if (isQuitting || !localServer?.hasOwnedServer()) return;
    if (localServer.getSettings().keepLocalServerRunning) {
      localServer.detachOwnedServer();
      return;
    }

    event.preventDefault();
    isQuitting = true;
    void localServer.shutdownOwnedServer().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

async function createDesktopWindow() {
  desktopWindow = new DesktopWindowManager({
    appName: APP_NAME,
    getWindowIconPath,
    getLauncherPath,
    getPreloadPath,
    openExternalUrl,
    getDesktopState,
    getDisplayTargetName,
    getRemoteEnvironmentMenuItems,
    getCloudState,
    getLocalState,
    tabs,
    actions: {
      copyDiagnostics,
      copyText: (text) => clipboard.writeText(text),
      clearCloudAccount,
      connectCloudAccount,
      getActiveTarget: () => activeTarget,
      getEnvironmentUrl: (environment) => cloud.getEnvironmentUrl(environment),
      openEnvironmentInBrowser,
      openEnvironmentInDesktop,
      openEnvironmentInIde,
      openEnvironmentInSsh,
      openLocalInDesktop,
      openLocalWebUi,
      openCloudDashboard,
      refreshCloudEnvironments: () => refreshCloudEnvironments({ showErrors: true }),
      setActiveTarget,
      showComputerUsePreview,
      showEnvironmentPicker,
      showError,
      startEnvironment,
      stopEnvironment,
      updateDesktopSetting,
      copyLocalWebUrl,
    },
  });

  desktopWindow.createTray();
  desktopWindow.configurePermissions();
  await desktopWindow.createWindow();
}

function registerSingleInstance() {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
    return false;
  }

  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith(`${CALLBACK_PROTOCOL}://`));
    if (deepLink) {
      void handleDeepLink(deepLink);
    }

    const window = desktopWindow?.getMainWindow();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  return true;
}

async function bootstrap() {
  app.name = APP_NAME;
  app.setName(APP_NAME);
  process.title = APP_NAME;

  await app.whenReady();
  app.setName(APP_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'CloudCLI',
  });

  localServer = new LocalServerController({
    appRoot: getAppRoot(),
    settingsPath: getSettingsPath(),
    isPackaged: app.isPackaged,
    onChange: syncDesktopState,
  });
  cloud = new CloudController({
    storePath: getStorePath(),
    controlPlaneUrl: CLOUDCLI_CONTROL_PLANE_URL,
    callbackUrl: CALLBACK_URL,
    onChange: syncDesktopState,
  });

  await localServer.loadDesktopSettings();
  await cloud.loadCloudAccount();

  registerProtocolHandler();
  registerIpcHandlers();
  registerAppEvents();
  await createDesktopWindow();
  void refreshCloudEnvironments({ showErrors: false });
}

if (registerSingleInstance()) {
  bootstrap().catch(async (error) => {
    await showError('CloudCLI failed to start', error);
    app.quit();
  });
}
