const { contextBridge, ipcRenderer } = require('electron');

function isCloudCliAppOrigin(location) {
  if (location.protocol === 'file:') return true;

  if (location.protocol === 'http:') {
    return location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  }

  return location.protocol === 'https:' && (
    location.hostname === 'cloudcli.ai' || location.hostname.endsWith('.cloudcli.ai')
  );
}

function onDesktopStateUpdated(callback) {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('cloudcli-desktop:state-updated', listener);
  return () => {
    ipcRenderer.removeListener('cloudcli-desktop:state-updated', listener);
  };
}

if (isCloudCliAppOrigin(window.location)) {
  contextBridge.exposeInMainWorld('cloudcliDesktopNotifications', {
    getState: () => ipcRenderer.invoke('cloudcli-desktop:get-state'),
    update: (settings) => ipcRenderer.invoke('cloudcli-desktop:update-desktop-notifications', settings),
    onStateUpdated: onDesktopStateUpdated,
  });
}

if (window.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('cloudcliDesktop', {
    connectCloud: () => ipcRenderer.invoke('cloudcli-desktop:connect-cloud'),
    disconnectCloud: () => ipcRenderer.invoke('cloudcli-desktop:disconnect-cloud'),
    copyDiagnostics: () => ipcRenderer.invoke('cloudcli-desktop:copy-diagnostics'),
    copyLocalWebUrl: () => ipcRenderer.invoke('cloudcli-desktop:copy-local-web-url'),
    getState: () => ipcRenderer.invoke('cloudcli-desktop:get-state'),
    openCloudDashboard: () => ipcRenderer.invoke('cloudcli-desktop:open-cloud-dashboard'),
    openEnvironment: (environmentId) => ipcRenderer.invoke('cloudcli-desktop:open-environment', environmentId),
    runActiveEnvironmentAction: (action) => ipcRenderer.invoke('cloudcli-desktop:run-active-environment-action', action),
    openLocal: () => ipcRenderer.invoke('cloudcli-desktop:open-local'),
    openLocalWebUi: () => ipcRenderer.invoke('cloudcli-desktop:open-local-web-ui'),
    refreshEnvironments: () => ipcRenderer.invoke('cloudcli-desktop:refresh-environments'),
    refreshActiveTab: () => ipcRenderer.invoke('cloudcli-desktop:reload-active-tab'),
    showEnvironmentPicker: () => ipcRenderer.invoke('cloudcli-desktop:show-environment-picker'),
    showLauncher: () => ipcRenderer.invoke('cloudcli-desktop:show-launcher'),
    showLocalSettings: () => ipcRenderer.invoke('cloudcli-desktop:show-local-settings'),
    showDesktopSettings: () => ipcRenderer.invoke('cloudcli-desktop:show-desktop-settings'),
    closeSettingsWindow: () => ipcRenderer.invoke('cloudcli-desktop:close-settings-window'),
    showActiveEnvironmentActionsMenu: () => ipcRenderer.invoke('cloudcli-desktop:show-active-environment-actions-menu'),
    showEnvironmentActionsMenu: (environmentId) => ipcRenderer.invoke('cloudcli-desktop:show-environment-actions-menu', environmentId),
    switchTab: (tabId) => ipcRenderer.invoke('cloudcli-desktop:switch-tab', tabId),
    closeTab: (tabId) => ipcRenderer.invoke('cloudcli-desktop:close-tab', tabId),
    updateSetting: (key, value) => ipcRenderer.invoke('cloudcli-desktop:update-setting', key, value),
    onStateUpdated: onDesktopStateUpdated,
    onLauncherCommand: (callback) => {
      ipcRenderer.on('cloudcli-desktop:launcher-command', (_event, command) => callback(command));
    },
  });
}
