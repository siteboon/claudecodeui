const { contextBridge, ipcRenderer } = require('electron');

if (window.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('cloudcliDesktop', {
    connectCloud: () => ipcRenderer.invoke('cloudcli-desktop:connect-cloud'),
    copyDiagnostics: () => ipcRenderer.invoke('cloudcli-desktop:copy-diagnostics'),
    copyLocalWebUrl: () => ipcRenderer.invoke('cloudcli-desktop:copy-local-web-url'),
    getState: () => ipcRenderer.invoke('cloudcli-desktop:get-state'),
    openCloudDashboard: () => ipcRenderer.invoke('cloudcli-desktop:open-cloud-dashboard'),
    openEnvironment: (environmentId) => ipcRenderer.invoke('cloudcli-desktop:open-environment', environmentId),
    runActiveEnvironmentAction: (action) => ipcRenderer.invoke('cloudcli-desktop:run-active-environment-action', action),
    openLocal: () => ipcRenderer.invoke('cloudcli-desktop:open-local'),
    openLocalWebUi: () => ipcRenderer.invoke('cloudcli-desktop:open-local-web-ui'),
    refreshEnvironments: () => ipcRenderer.invoke('cloudcli-desktop:refresh-environments'),
    showEnvironmentPicker: () => ipcRenderer.invoke('cloudcli-desktop:show-environment-picker'),
    showLauncher: () => ipcRenderer.invoke('cloudcli-desktop:show-launcher'),
    showComputerAccess: () => ipcRenderer.invoke('cloudcli-desktop:show-computer-access'),
    showLocalSettings: () => ipcRenderer.invoke('cloudcli-desktop:show-local-settings'),
    updateComputerUse: (settings) => ipcRenderer.invoke('cloudcli-desktop:update-computer-use', settings),
    requestComputerUsePermission: (permission) => ipcRenderer.invoke('cloudcli-desktop:request-computer-use-permission', permission),
    showDesktopSettings: () => ipcRenderer.invoke('cloudcli-desktop:show-desktop-settings'),
    closeSettingsWindow: () => ipcRenderer.invoke('cloudcli-desktop:close-settings-window'),
    showActiveEnvironmentActionsMenu: () => ipcRenderer.invoke('cloudcli-desktop:show-active-environment-actions-menu'),
    showEnvironmentActionsMenu: (environmentId) => ipcRenderer.invoke('cloudcli-desktop:show-environment-actions-menu', environmentId),
    switchTab: (tabId) => ipcRenderer.invoke('cloudcli-desktop:switch-tab', tabId),
    closeTab: (tabId) => ipcRenderer.invoke('cloudcli-desktop:close-tab', tabId),
    updateSetting: (key, value) => ipcRenderer.invoke('cloudcli-desktop:update-setting', key, value),
    onStateUpdated: (callback) => {
      ipcRenderer.on('cloudcli-desktop:state-updated', (_event, state) => callback(state));
    },
    onLauncherCommand: (callback) => {
      ipcRenderer.on('cloudcli-desktop:launcher-command', (_event, command) => callback(command));
    },
  });
}
