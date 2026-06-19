window.__APP_VERSION__ = '1.34.0';
window.__MOCK_STATE__ = {
  account: { connected: true, email: 'you@cloudcli.ai' },
  activeTarget: { kind: 'launcher', name: 'Launcher', url: null },
  cloudLoading: false,
  desktopSettings: { keepLocalServerRunning: false, exposeLocalServerOnNetwork: false, themeMode: 'system' },
  localWebUrl: 'http://localhost:3001',
  shareableWebUrl: 'http://localhost:3001',
  localServerRunning: false,
  localStartupLogs: [],
  computerUse: { enabled: false, consentMode: 'ask', running: false, connectedCount: 0, targetCount: 0 },
  computerUsePermissions: {
    platform: 'darwin',
    supported: true,
    accessibility: 'not_granted',
    screenRecording: 'not_determined',
    message: 'macOS requires Accessibility and Screen Recording for Computer Use.',
  },
  environments: [
    { id: 'env-api', name: 'api-gateway', subdomain: 'api-gateway', access_url: 'https://api-gateway.cloudcli.ai', status: 'running', region: 'fra1', agent: 'Claude Code' },
    { id: 'env-web', name: 'web-frontend', subdomain: 'web-frontend', access_url: 'https://web-frontend.cloudcli.ai', status: 'stopped', region: 'sfo1', agent: 'Codex' },
    { id: 'env-data', name: 'data-pipeline', subdomain: 'data-pipeline', access_url: 'https://data-pipeline.cloudcli.ai', status: 'stopped', region: 'fra1', agent: 'Cursor' },
    { id: 'env-ml', name: 'ml-trainer', subdomain: 'ml-trainer', access_url: 'https://ml-trainer.cloudcli.ai', status: 'paused', region: 'iad1', agent: 'Gemini' },
  ],
};

(function cloudCliLauncher() {
  var MOCK = window.__MOCK_STATE__ || {};
  var VERSION = window.__APP_VERSION__ || '';
  var LOGO_URL = new URL('../../public/logo-32.png', window.location.href).toString();
  var SEARCH = new URLSearchParams(window.location.search || '');

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var mockState = clone(MOCK);
  var mockBridge = {
    getState: function () { return Promise.resolve(clone(mockState)); },
    openLocal: function () {
      mockState.localServerRunning = true;
      mockState.activeTarget = { kind: 'local', name: 'Local CloudCLI', url: mockState.localWebUrl };
      return Promise.resolve(clone(mockState));
    },
    openLocalWebUi: function () {
      mockState.localServerRunning = true;
      return Promise.resolve(clone(mockState));
    },
    copyLocalWebUrl: function () { return Promise.resolve(clone(mockState)); },
    connectCloud: function () {
      mockState.account = { connected: true, email: 'you@cloudcli.ai' };
      return Promise.resolve(clone(mockState));
    },
    refreshEnvironments: function () { return Promise.resolve(clone(mockState)); },
    copyDiagnostics: function () { return Promise.resolve(clone(mockState)); },
    showComputerAccess: function () { return Promise.resolve(clone(mockState)); },
    showEnvironmentPicker: function () { return Promise.resolve(clone(mockState)); },
    showLauncher: function () { return Promise.resolve(clone(mockState)); },
    showLocalSettings: function () { return Promise.resolve(clone(mockState)); },
    showDesktopSettings: function () { return Promise.resolve(clone(mockState)); },
    closeSettingsWindow: function () { return Promise.resolve(clone(mockState)); },
    showActiveEnvironmentActionsMenu: function () { return Promise.resolve(clone(mockState)); },
    openCloudDashboard: function () { return Promise.resolve(clone(mockState)); },
    runActiveEnvironmentAction: function () { return Promise.resolve(clone(mockState)); },
    switchTab: function (id) { mockState.activeTabId = id; return Promise.resolve(clone(mockState)); },
    closeTab: function (id) {
      mockState.tabs = (mockState.tabs || []).filter(function (tab) { return tab.id === 'home' || tab.id !== id; });
      if (mockState.activeTabId === id) mockState.activeTabId = 'home';
      return Promise.resolve(clone(mockState));
    },
    updateSetting: function (key, value) {
      mockState.desktopSettings = mockState.desktopSettings || {};
      mockState.desktopSettings[key] = key === 'themeMode' ? value : !!value;
      return Promise.resolve(clone(mockState));
    },
    updateComputerUse: function (settings) {
      mockState.computerUse = mockState.computerUse || { enabled: false, consentMode: 'ask', running: false, connectedCount: 0, targetCount: 0 };
      if (typeof settings.enabled === 'boolean') mockState.computerUse.enabled = settings.enabled;
      if (settings.consentMode === 'auto' || settings.consentMode === 'ask') mockState.computerUse.consentMode = settings.consentMode;
      mockState.computerUse.running = mockState.computerUse.enabled;
      return Promise.resolve(clone(mockState));
    },
    requestComputerUsePermission: function (permission) {
      mockState.computerUsePermissions = mockState.computerUsePermissions || {};
      if (permission === 'accessibility') mockState.computerUsePermissions.accessibility = 'granted';
      if (permission === 'screen') mockState.computerUsePermissions.screenRecording = 'granted';
      if (permission === 'all') {
        mockState.computerUsePermissions.accessibility = 'granted';
        mockState.computerUsePermissions.screenRecording = 'granted';
      }
      return Promise.resolve(clone(mockState));
    },
    openEnvironment: function (id) {
      var env = (mockState.environments || []).filter(function (item) { return item.id === id; })[0];
      if (env) {
        env.status = 'starting';
        setTimeout(function () {
          env.status = 'running';
          mockState.activeTarget = { kind: 'remote', id: id, name: env.name, url: env.access_url };
        }, 1700);
      }
      return Promise.resolve(clone(mockState));
    },
  };

  var bridge = window.cloudcliDesktop || mockBridge;

  var ICONS = {
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.34 9 4 4 0 0 0 7 19z"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6l-.03.08a2 2 0 1 1-3.94 0L10 20a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1l-.08-.03a2 2 0 1 1 0-3.94L4 10a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6l.03-.08a2 2 0 1 1 3.94 0L14 4a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.36.4.7.6 1l.08.03a2 2 0 1 1 0 3.94L20 14a1.7 1.7 0 0 0-.6 1z"/>',
    play: '<polygon points="6 4 20 12 6 20 6 4"/>',
    arrow: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    cloudPlus: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.34 9 4 4 0 0 0 7 19z"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  };
  var FILLED = { play: true };

  function icon(name, size) {
    size = size || 16;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="' + (FILLED[name] ? 'currentColor' : 'none') + '" stroke="' + (FILLED[name] ? 'none' : 'currentColor') + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusMeta(status) {
    var map = {
      running: { label: 'Running', cls: 'ok', dot: '#10b981', verb: 'Opening', open: 'Open' },
      starting: { label: 'Starting', cls: 'warn', dot: '#f59e0b', verb: 'Starting', open: 'Open', busy: true },
      stopped: { label: 'Stopped', cls: 'idle', dot: '#6b7280', verb: 'Starting', open: 'Start & open' },
      paused: { label: 'Paused', cls: 'warn', dot: '#f59e0b', verb: 'Resuming', open: 'Resume' },
    };
    return map[status] || { label: status || 'Unknown', cls: 'idle', dot: '#6b7280', verb: 'Starting', open: 'Start & open' };
  }

  function connected(state) {
    return !!(state && state.account && state.account.connected);
  }

  function authState(state) {
    return state && state.account ? (state.account.authState || (state.account.connected ? 'connected' : 'logged_out')) : 'logged_out';
  }

  function accountLabel(state) {
    if (authState(state) === 'expired') return 'Reconnect';
    if (state && state.account && state.account.email) return state.account.email;
    if (connected(state)) return 'Connected';
    return 'Log in';
  }

  function localUrl(state) {
    return (state && (state.shareableWebUrl || state.localWebUrl)) || '';
  }

  function envCount(state) {
    var count = state && state.environments ? state.environments.length : 0;
    return count + ' environment' + (count === 1 ? '' : 's');
  }

  function errMsg(error) {
    return error && error.message ? error.message : String(error);
  }

  function resolveTheme(state) {
    var settings = state && state.desktopSettings ? state.desktopSettings : {};
    var mode = settings.themeMode || 'system';
    if (mode === 'light' || mode === 'dark') return mode;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function computerUseStatus(state) {
    var computerUse = state && state.computerUse ? state.computerUse : {};
    var connectedCount = computerUse.connectedCount || 0;
    var environmentLabel = connectedCount + ' environment' + (connectedCount === 1 ? '' : 's');
    if (!computerUse.enabled) {
      return { label: 'Disabled', tone: 'idle', detail: 'CloudCLI cannot use this computer.' };
    }
    if (!connectedCount) {
      return { label: 'Not connected', tone: 'warn', detail: 'No environment connected.' };
    }
    if (computerUse.consentMode === 'auto') {
      return { label: 'Connected', tone: 'warn', detail: environmentLabel + ' connected. Unattended access is on.' };
    }
    return { label: 'Connected', tone: 'ok', detail: environmentLabel + ' connected.' };
  }

  var CC = {
    icon: icon,
    esc: esc,
    statusMeta: statusMeta,
    connected: connected,
    authState: authState,
    accountLabel: accountLabel,
    localUrl: localUrl,
    envCount: envCount,
    computerUseStatus: computerUseStatus,
    version: VERSION,
    logoUrl: LOGO_URL,
    platform: 'win',
    state: clone(MOCK),
    ui: {},
    _busyEnv: null,
    _status: { msg: '', tone: '' },
    _reg: {},
    _wired: false,
    _poll: null,
    modalMode: SEARCH.get('modal') === '1',
  };

  window.CC = CC;

  var app;
  var overlay;

  CC.setState = function (state) {
    var currentSheet = CC.ui.openSheet || (CC.modalMode ? (CC.ui.initialSheet || 'desktop-settings') : null);
    var sheetBody = overlay ? overlay.querySelector('.cc-sheet-body') : null;
    var scrollTop = sheetBody ? sheetBody.scrollTop : 0;
    if (state && typeof state === 'object') CC.state = state;
    CC.applyTheme(CC.state);
    CC.render(CC.state);
    if (currentSheet) {
      CC.openSheet(currentSheet, { scrollTop: scrollTop });
    }
  };

  CC.applyTheme = function (state) {
    var settings = state && state.desktopSettings ? state.desktopSettings : {};
    var themeMode = settings.themeMode || 'system';
    var resolvedTheme = resolveTheme(state);
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-theme-mode', themeMode);
  };

  CC.refresh = function () {
    return Promise.resolve(bridge.getState()).then(function (state) {
      CC.setState(state);
      return state;
    });
  };

  CC.run = function (label, fn) {
    CC._status = { msg: label, tone: 'progress' };
    CC.render(CC.state);
    return Promise.resolve()
      .then(fn)
      .then(function (state) {
        if (state && state.environments) CC.state = state;
        return CC.refresh();
      })
      .then(function () {
        CC._status = { msg: '', tone: '' };
        CC.render(CC.state);
      })
      .catch(function (error) {
        CC._status = { msg: errMsg(error), tone: 'error' };
        CC.render(CC.state);
      });
  };

  CC.startPolling = function () {
    if (CC._poll) return;
    var ticks = 0;
    CC._poll = setInterval(function () {
      ticks += 1;
      Promise.resolve(bridge.getState()).then(function (state) {
        CC.setState(state);
        var anyStarting = (state.environments || []).some(function (environment) { return environment.status === 'starting'; });
        if (!anyStarting || ticks > 16) {
          clearInterval(CC._poll);
          CC._poll = null;
          if (!anyStarting) {
            CC._status = { msg: '', tone: '' };
            CC.render(CC.state);
          }
        }
      });
    }, 1500);
  };

  CC.openEnv = function (id) {
    var env = (CC.state.environments || []).filter(function (environment) { return environment.id === id; })[0];
    var meta = statusMeta(env ? env.status : '');
    CC._busyEnv = id;
    CC._status = { msg: (meta.verb || 'Opening') + ' ' + ((env && (env.name || env.subdomain)) || 'environment') + '...', tone: 'progress' };
    if (env) {
      var tabId = 'remote:' + env.id;
      var tabs = CC.state.tabs && CC.state.tabs.length ? CC.state.tabs : [{ id: 'home', title: 'Launcher', kind: 'launcher', closable: false }];
      tabs = tabs.map(function (tab) {
        tab.active = false;
        return tab;
      });
      var existing = tabs.filter(function (tab) { return tab.id === tabId; })[0];
      if (existing) {
        existing.active = true;
        existing.title = env.name || env.subdomain;
      } else {
        tabs.push({ id: tabId, title: env.name || env.subdomain, kind: 'remote', closable: true, active: true });
      }
      CC.state.tabs = tabs;
      CC.state.activeTabId = tabId;
    }
    if (env && env.status !== 'running') env.status = 'starting';
    CC.render(CC.state);
    return Promise.resolve(bridge.openEnvironment(id)).then(function (state) {
      if (state && state.environments) CC.setState(state);
      CC.startPolling();
    }).catch(function (error) {
      CC._busyEnv = null;
      if (env) env.status = 'stopped';
      CC._status = { msg: errMsg(error), tone: 'error' };
      CC.render(CC.state);
    });
  };

  CC.act = function (name, node) {
    switch (name) {
      case 'local':
        return CC.run('Starting Local CloudCLI...', function () { return bridge.openLocal(); });
      case 'connect':
        return CC.run('Opening cloudcli.ai to connect your account...', function () { return bridge.connectCloud(); });
      case 'open-web':
        return CC.run('Opening local web UI in your browser...', function () { return bridge.openLocalWebUi(); });
      case 'copy-web':
        return CC.run('Copied local URL to clipboard', function () { return bridge.copyLocalWebUrl(); });
      case 'diagnostics':
        return CC.run('Copied diagnostics to clipboard', function () { return bridge.copyDiagnostics(); });
      case 'set-setting':
        return CC.run('Saved', function () { return bridge.updateSetting(node.key, node.value); });
      case 'set-theme-mode':
        return CC.run('Saved', function () { return bridge.updateSetting('themeMode', node.value); });
      case 'set-computer-mode':
        CC.state.computerUse = {
          ...((CC.state && CC.state.computerUse) || {}),
          enabled: true,
          consentMode: node.value === 'auto' ? 'auto' : 'ask',
        };
        return CC.run('Saved', function () {
          return bridge.updateComputerUse({
            enabled: true,
            consentMode: node.value,
          });
        });
      case 'set-computer-enabled':
        CC.state.computerUse = {
          ...((CC.state && CC.state.computerUse) || {}),
          enabled: !!node.value,
        };
        return CC.run('Saved', function () {
          var current = (CC.state && CC.state.computerUse) || { consentMode: 'ask' };
          return bridge.updateComputerUse({
            enabled: !!node.value,
            consentMode: current.consentMode === 'auto' ? 'auto' : 'ask',
          });
        });
      case 'computer-permission':
        return CC.run('Opening permission settings...', function () {
          return bridge.requestComputerUsePermission(node.getAttribute('data-cc-computer-permission'));
        });
      case 'settings-toggle':
        return CC.run('Opening desktop settings...', function () { return bridge.showDesktopSettings(); });
      case 'desktop-settings-toggle':
        return CC.run('Opening desktop settings...', function () { return bridge.showDesktopSettings(); });
      case 'local-settings-toggle':
        return CC.run('Opening local settings...', function () { return bridge.showLocalSettings(); });
      case 'computer-settings-toggle':
        return CC.run('Opening desktop settings...', function () { return bridge.showDesktopSettings(); });
      case 'settings-close':
        return CC.closeSheet();
      case 'dashboard':
        return CC.run('Opening CloudCLI dashboard...', function () { return bridge.openCloudDashboard(); });
      case 'refresh-environments':
        return CC.run('Refreshing cloud environments...', function () { return bridge.refreshEnvironments(); });
      case 'env-action':
        return CC.run('Opening environment...', function () { return bridge.runActiveEnvironmentAction(node.getAttribute('data-cc-env-action')); });
      case 'env-menu':
        return CC.run('Opening environment actions...', function () { return bridge.showActiveEnvironmentActionsMenu(); });
      case 'env-row-menu':
        return CC.run('Opening environment actions...', function () { return bridge.showEnvironmentActionsMenu(node.getAttribute('data-cc-environment-id')); });
      default:
        return;
    }
  };

  function renderTabs(state) {
    var tabs = state.tabs && state.tabs.length ? state.tabs : [{ id: 'home', title: 'Home', closable: false, active: true }];
    return tabs.map(function (tab) {
      var title = tab.title || '';
      var visibleChars = Math.min(title.length, 20);
      var tabWidth = Math.max(112, Math.min(232, (visibleChars * 8) + (tab.closable ? 56 : 38)));
      return '<button class="tb-tab no-drag' + (tab.active ? ' active' : '') + '" data-cc-tab="' + esc(tab.id) + '" title="' + esc(title) + '" style="width:' + tabWidth + 'px;flex-basis:' + tabWidth + 'px">' +
        '<span>' + esc(title) + '</span>' +
        (tab.closable ? '<span class="tb-close" data-cc-close-tab="' + esc(tab.id) + '" title="Close tab">&times;</span>' : '') +
        '</button>';
    }).join('');
  }

  CC.titlebar = function (state) {
    var conn = connected(state);
    var activeRemote = state.activeTarget && state.activeTarget.kind === 'remote';
    var envActions = activeRemote ? '<button class="btn sm tb-action no-drag" data-cc-action="env-menu" title="Open environment actions">Open environment in...</button>' : '';
    return '<div class="titlebar">' +
      '<div class="brand"><img class="mk" src="' + esc(LOGO_URL) + '" alt=""><span>CloudCLI</span></div>' +
      '<div class="tb-tabs no-drag">' + renderTabs(state) + '</div>' +
      '<span style="flex:1"></span>' +
      envActions +
      '<button class="btn sm tb-action no-drag" data-cc-action="connect" title="' + esc(authState(state) === 'expired' ? 'Reconnect your CloudCLI account' : accountLabel(state)) + '"><span class="dot" style="background:' + (conn ? 'var(--ok)' : (authState(state) === 'expired' ? 'var(--warn)' : 'var(--tx3)')) + '"></span>' + esc(accountLabel(state)) + '</button>' +
      '<button class="icon-btn tb-action no-drag" data-cc-action="settings-toggle" title="Settings">' + icon('settings', 16) + '</button>' +
      '</div>';
  };

  CC.statusbar = function (state) {
    var status = CC._status || {};
    var running = !!state.localServerRunning;
    return '<div class="statusbar">' +
      '<span><span class="dot" style="width:7px;height:7px;background:' + (running ? 'var(--ok)' : 'var(--tx3)') + '"></span> local ' + (running ? 'running · ' + esc(localUrl(state)) : 'idle') + '</span>' +
      '<span class="sep">·</span><span>' + esc(envCount(state)) + '</span>' +
      '<span class="sep">·</span><span>' + (authState(state) === 'expired' ? 'session expired' : (connected(state) ? esc(accountLabel(state)) : 'not connected')) + '</span>' +
      '<span style="flex:1"></span>' +
      (status.msg ? '<span class="status-msg ' + esc(status.tone) + '">' + esc(status.msg) + '</span><span class="sep">·</span>' : '') +
      '<span>v' + esc(VERSION) + '</span>' +
      '</div>';
  };

  CC.renderSheet = function (title, subtitle, sections, footer) {
    overlay.innerHTML =
      '<div class="cc-sheet cc-modal">' +
      '<div class="cc-sheet-header">' +
      '<div class="cc-sheet-copy"><div class="cc-sheet-title">' + esc(title) + '</div><div class="cc-sheet-subtitle">' + esc(subtitle || '') + '</div></div>' +
      '<button class="icon-btn cc-sheet-close" data-cc-action="settings-close" title="Close">' + icon('x', 16) + '</button>' +
      '</div>' +
      '<div class="cc-sheet-body">' + sections.join('') + '</div>' +
      (footer ? '<div class="cc-sheet-footer">' + footer + '</div>' : '') +
      '</div>';
  };

  CC.renderSection = function (eyebrow, title, body) {
    return '<section class="cc-section">' +
      '<div class="cc-section-head">' +
      '<div class="lbl">' + esc(eyebrow) + '</div>' +
      '<div class="cc-section-title">' + esc(title) + '</div>' +
      '</div>' +
      '<div class="cc-section-body">' + body + '</div>' +
      '</section>';
  };

  CC.renderRadioOption = function (name, value, checked, title, description) {
    return '<label class="cc-choice">' +
      '<input type="radio" name="' + esc(name) + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + '>' +
      '<span><b>' + esc(title) + '</b><br>' + esc(description) + '</span>' +
      '</label>';
  };

  CC.openSheet = function (sheet, options) {
    options = options || {};
    if (sheet === 'desktop-settings') {
      CC.renderDesktopSettings();
    } else {
      CC.renderLocalSettings();
    }
    CC.ui.openSheet = sheet;
    overlay.classList.add('open');
    if (typeof options.scrollTop === 'number') {
      var body = overlay.querySelector('.cc-sheet-body');
      if (body) body.scrollTop = options.scrollTop;
    }
  };

  CC.closeSheet = function () {
    if (CC.modalMode && bridge.closeSettingsWindow) {
      CC.ui.openSheet = null;
      return bridge.closeSettingsWindow();
    }
    CC.ui.openSheet = null;
    overlay.classList.remove('open');
  };

  CC.buildLocalServerSection = function (state, options) {
    options = options || {};
    var settings = state.desktopSettings || {};
    var url = localUrl(state) || 'starts on demand';
    var body = '<div class="cc-surface">' +
      '<div class="cc-meta mono">' + esc(url) + '</div>' +
      '<div class="cc-row2"><button class="btn sm" data-cc-action="open-web">' + icon('arrow', 14) + 'Open in browser</button><button class="btn sm" data-cc-action="copy-web">' + icon('copy', 14) + 'Copy URL</button></div>';
    if (options.includePreferences) {
      body +=
        '<label class="cc-toggle"><input type="checkbox" data-cc-setting="keepLocalServerRunning"' + (settings.keepLocalServerRunning ? ' checked' : '') + '><span><b>Keep server running</b><br>Leave Local CloudCLI available after you quit the app.</span></label>' +
        '<label class="cc-toggle"><input type="checkbox" data-cc-setting="exposeLocalServerOnNetwork"' + (settings.exposeLocalServerOnNetwork ? ' checked' : '') + '><span><b>Allow LAN access</b><br>Use the copied URL from another device on this network.</span></label>';
    }
    body += '</div>';
    return CC.renderSection(
      options.eyebrow || 'LOCAL SERVER',
      options.title || 'Run Local CloudCLI on this machine',
      body
    );
  };

  CC.buildThemeSection = function (state) {
    var settings = state.desktopSettings || {};
    return CC.renderSection('APPEARANCE', 'Desktop theme', '' +
      '<div class="cc-surface cc-choice-group">' +
      CC.renderRadioOption('desktop-theme', 'system', settings.themeMode === 'system', 'System', 'Follow the operating system appearance.') +
      CC.renderRadioOption('desktop-theme', 'light', settings.themeMode === 'light', 'Light', 'Use the light interface appearance.') +
      CC.renderRadioOption('desktop-theme', 'dark', settings.themeMode === 'dark', 'Dark', 'Use the dark interface appearance.') +
      '</div>'
    );
  };

  function permissionLabel(value) {
    if (value === 'granted') return 'Granted';
    if (value === 'denied' || value === 'restricted') return 'Needs attention';
    if (value === 'not_applicable') return 'Not required';
    return 'Not granted';
  }

  function permissionTone(value) {
    if (value === 'granted' || value === 'not_applicable') return 'ok';
    if (value === 'denied' || value === 'restricted') return 'warn';
    return 'idle';
  }

  function renderComputerPermissionRow(key, label, detail, status) {
    return '<div class="cc-permission-row">' +
      '<div><div class="cc-permission-title">' + CC.esc(label) + '</div><div class="cc-permission-detail">' + CC.esc(detail) + '</div></div>' +
      '<div class="cc-permission-actions"><span class="badge ' + permissionTone(status) + '">' + CC.esc(permissionLabel(status)) + '</span>' +
      (status === 'granted' || status === 'not_applicable'
        ? ''
        : '<button class="btn sm" data-cc-action="computer-permission" data-cc-computer-permission="' + CC.esc(key) + '">Open settings</button>') +
      '</div>' +
      '</div>';
  }

  function renderComputerPermissions(state) {
    var permissions = state.computerUsePermissions || {};
    if (!permissions.supported) {
      return '<div class="cc-note">' + CC.esc(permissions.message || 'No additional OS permission setup is required from CloudCLI on this platform.') + '</div>';
    }
    return '<div class="cc-note">' + CC.esc(permissions.message || 'Grant the required OS permissions before approving agent control.') + '</div>' +
      renderComputerPermissionRow('accessibility', 'Accessibility', 'Allows CloudCLI to click, type, and use accessibility actions.', permissions.accessibility) +
      renderComputerPermissionRow('screen', 'Screen Recording', 'Allows CloudCLI to capture screenshots for agent observation.', permissions.screenRecording);
  }

  CC.buildComputerUseSection = function (state) {
    var computerUse = state.computerUse || {};
    var status = computerUseStatus(state);
    var body =
      '<div class="cc-surface">' +
      '<label class="cc-toggle"><input type="checkbox" data-cc-computer-enabled="true"' + (computerUse.enabled ? ' checked' : '') + '><span><b>Enable Computer Use</b><br>Let CloudCLI use the computer. Agents cannot act until you approve a session.</span></label>' +
      '<div class="cc-row2"><span class="badge ' + CC.esc(status.tone) + '">' + CC.esc(status.label) + '</span><span class="cc-meta">' + CC.esc(status.detail) + '</span><button class="btn sm" data-cc-action="refresh-environments">' + CC.icon('refresh', 14) + 'Refresh / relink</button></div>';
    if (computerUse.enabled) {
      body += '<div class="cc-permissions">' + renderComputerPermissions(state) + '</div>';
      body += '<div class="cc-choice-group">' +
        CC.renderRadioOption('computer-access-mode', 'ask', computerUse.consentMode !== 'auto', 'Ask before each session', 'Agents can request control, but you approve every session.') +
        CC.renderRadioOption('computer-access-mode', 'auto', computerUse.consentMode === 'auto', 'Unattended access', 'Trusted agents can use this computer without a local approval prompt.') +
        '</div>';
    }
    body += '</div>';
    return CC.renderSection('COMPUTER USE', 'Control how agents can use this computer', body);
  };

  CC.renderLocalSettings = function () {
    var state = CC.state || {};
    var sections = [
      CC.buildLocalServerSection(state, { includePreferences: false }),
      CC.renderSection('PREFERENCES', 'How the local service behaves', '' +
        '<div class="cc-surface">' +
        '<label class="cc-toggle"><input type="checkbox" data-cc-setting="keepLocalServerRunning"' + ((state.desktopSettings || {}).keepLocalServerRunning ? ' checked' : '') + '><span><b>Keep server running</b><br>Leave Local CloudCLI available after you quit the app.</span></label>' +
        '<label class="cc-toggle"><input type="checkbox" data-cc-setting="exposeLocalServerOnNetwork"' + ((state.desktopSettings || {}).exposeLocalServerOnNetwork ? ' checked' : '') + '><span><b>Allow LAN access</b><br>Use the copied URL from another device on this network.</span></label>' +
        '</div>'
      ),
    ];
    CC.renderSheet('Local Settings', 'Manage how Local CloudCLI runs on this computer.', sections);
  };

  CC.renderDesktopSettings = function () {
    var state = CC.state || {};
    var sections = [
      CC.buildThemeSection(state),
      CC.buildComputerUseSection(state),
    ];
    CC.renderSheet('Desktop Settings', 'Manage the desktop app appearance and Computer Use behavior.', sections);
  };

  CC.render = function (state) {
    state = state || CC.state;
    var titlebar = (CC._reg.titlebar || CC.titlebar)(state);
    var statusbar = (CC._reg.statusbar || CC.statusbar)(state);
    var body = CC._reg.renderBody ? CC._reg.renderBody(state) : '';
    if (CC.modalMode) {
      app.innerHTML = '';
    } else {
      app.innerHTML = titlebar + '<div class="cc-body ' + (CC._reg.bodyClass || '') + '">' + body + '</div>' + statusbar;
    }
    if (CC._reg.afterRender) CC._reg.afterRender(state);
  };

  function wireEvents() {
    if (CC._wired) return;
    CC._wired = true;

    document.addEventListener('click', function (event) {
      if (CC._reg.onClick && CC._reg.onClick(event)) return;
      var closeTab = event.target.closest('[data-cc-close-tab]');
      if (closeTab) {
        event.stopPropagation();
        CC.run('Closing tab...', function () { return bridge.closeTab(closeTab.getAttribute('data-cc-close-tab')); });
        return;
      }
      var tab = event.target.closest('[data-cc-tab]');
      if (tab) {
        CC.run('Switching tab...', function () { return bridge.switchTab(tab.getAttribute('data-cc-tab')); });
        return;
      }
      var action = event.target.closest('[data-cc-action]');
      if (action) {
        CC.act(action.getAttribute('data-cc-action'), action);
        return;
      }
      var env = event.target.closest('[data-cc-env]');
      if (env) {
        CC.openEnv(env.getAttribute('data-cc-env'));
        return;
      }
      if (overlay.classList.contains('open') && !event.target.closest('.cc-sheet')) {
        CC.closeSheet();
      }
    });

    document.addEventListener('change', function (event) {
      var setting = event.target.closest('[data-cc-setting]');
      if (setting) {
        CC.act('set-setting', {
          key: setting.getAttribute('data-cc-setting'),
          value: setting.checked,
        });
        return;
      }
      var theme = event.target.closest('[name="desktop-theme"]');
      if (theme) {
        CC.act('set-theme-mode', { value: theme.value });
        return;
      }
      var computerMode = event.target.closest('[name="computer-access-mode"]');
      if (computerMode) {
        CC.act('set-computer-mode', { value: computerMode.value });
        return;
      }
      var computerEnabled = event.target.closest('[data-cc-computer-enabled]');
      if (computerEnabled) {
        CC.act('set-computer-enabled', { value: computerEnabled.checked });
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && overlay.classList.contains('open')) {
        CC.closeSheet();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        CC.act('settings-toggle');
        return;
      }
      if (overlay.classList.contains('open')) return;
      if (CC._reg.onKey) CC._reg.onKey(event, CC.state);
    });
  }

  function boot() {
    app = document.getElementById('app');
    overlay = document.createElement('div');
    overlay.id = 'cc-overlay';
    overlay.className = 'cc-overlay';
    document.body.appendChild(overlay);

    var isMac = /Mac/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent);
    var isWin = /Win/i.test(navigator.platform);
    CC.platform = isMac ? 'mac' : (isWin ? 'win' : 'linux');
    document.body.classList.add(CC.platform);
    CC.ui.initialSheet = SEARCH.get('sheet') || 'desktop-settings';
    if (CC.modalMode) {
      document.documentElement.classList.add('cc-modal-window');
      document.body.classList.add('cc-modal-window');
    }

    wireEvents();
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        CC.applyTheme(CC.state);
      });
    }
    if (bridge.onStateUpdated) {
      bridge.onStateUpdated(function (state) { CC.setState(state); });
    }
    if (bridge.onLauncherCommand) {
      bridge.onLauncherCommand(function (command) {
        if (command && command.type === 'open-sheet') {
          CC.ui.initialSheet = command.sheet || CC.ui.initialSheet || 'desktop-settings';
          CC.openSheet(command.sheet);
        }
      });
    }
    CC.refresh().catch(function (error) {
      CC._status = { msg: errMsg(error), tone: 'error' };
      CC.render(CC.state);
    });
  }

  CC.register = function (registry) {
    CC._reg = registry || {};
  };

  CC.start = function () {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  };
})();

(function sidebarApp() {
  var CC = window.CC;

  function navItem(id, iconName, label, meta, selected) {
    return '<button class="sb-item' + (selected === id ? ' active' : '') + '" data-cc-nav="' + id + '">' +
      CC.icon(iconName, 16) + '<span>' + label + '</span><span class="sb-meta">' + CC.esc(meta) + '</span></button>';
  }

  function localPane(state) {
    return '<div class="pane-h"><div><h2 class="pane-title">Local servers</h2><p class="pane-sub">Manage Local CloudCLI on this machine. No account required.</p></div></div>' +
      '<div class="card"><div class="card-head"><div><div class="card-t">Local server</div><div class="card-sub mono">' + CC.esc(CC.localUrl(state) || 'Starts on demand') + '</div></div><div class="card-tools"><span class="dot" style="background:' + (state.localServerRunning ? 'var(--ok)' : 'var(--tx3)') + '"></span><button class="icon-btn" data-cc-action="local-settings-toggle" title="Local settings">' + CC.icon('gear', 16) + '</button></div></div>' +
      '<div class="card-actions"><button class="btn pri" data-cc-action="local">' + CC.icon('play', 15) + 'Open Local CloudCLI</button><button class="btn" data-cc-action="open-web">' + CC.icon('arrow', 14) + 'Open in browser</button><button class="btn" data-cc-action="copy-web">' + CC.icon('copy', 14) + 'Copy URL</button></div></div>';
  }

  function envRow(environment) {
    var meta = CC.statusMeta(environment.status);
    var tags = (environment.agent ? '<span class="tag">' + CC.esc(environment.agent) + '</span>' : '') + (environment.region ? '<span class="tag">' + CC.esc(environment.region) + '</span>' : '');
    return '<div class="env" data-cc-env="' + environment.id + '"><span class="dot" style="background:' + meta.dot + '"></span>' +
      '<div class="env-i"><div class="env-n">' + CC.esc(environment.name || environment.subdomain) + '</div><div class="env-u mono">' + CC.esc(environment.access_url || '') + '</div></div>' +
      '<div class="env-tags">' + tags + '</div>' +
      '<span class="badge ' + meta.cls + '">' + meta.label + '</span>' +
      '<button class="btn sm" data-cc-action="env-row-menu" data-cc-environment-id="' + environment.id + '">Open environment in...</button>' +
      '<button class="btn sm ' + (environment.status === 'running' ? 'pri' : '') + '">' + CC.icon(meta.busy ? 'refresh' : (environment.status === 'running' ? 'arrow' : 'play'), 14) + meta.open + '</button></div>';
  }

  function cloudPane(state) {
    var header = '<div class="pane-h"><div><h2 class="pane-title">Environments</h2><p class="pane-sub">' + CC.esc(CC.envCount(state)) + '</p></div><button class="btn sm" data-cc-action="dashboard">' + CC.icon('arrow', 14) + 'Dashboard</button></div>';
    if (CC.authState(state) === 'expired') {
      return header + '<div class="empty">Your CloudCLI session expired.<div style="margin-top:14px"><button class="btn pri" data-cc-action="connect">' + CC.icon('cloudPlus', 15) + 'Reconnect account</button></div></div>';
    }
    if (!CC.connected(state)) {
      return header + '<div class="empty">Connect your CloudCLI account to list hosted environments.<div style="margin-top:14px"><button class="btn pri" data-cc-action="connect">' + CC.icon('cloudPlus', 15) + 'Connect account</button></div></div>';
    }
    if (state.cloudLoading && !(state.environments || []).length) {
      return header + '<div class="empty">Loading your CloudCLI environments...</div>';
    }

    var list = (state.environments || []).map(envRow).join('');
    if (!list) list = '<div class="empty">No hosted environments yet.</div>';
    return header + list;
  }

  function renderBody(state) {
    var section = CC.ui.section || ((CC.connected(state) || CC.authState(state) === 'expired') ? 'cloud' : 'local');
    CC.ui.section = section;
    var nav = '<div class="sb"><div class="sb-grp"><div class="lbl">Launcher</div>' +
      navItem('local', 'terminal', 'Local servers', state.localServerRunning ? 'on' : 'idle', section) +
      navItem('cloud', 'cloud', 'Cloud environments', (state.environments || []).length, section) +
      '</div></div>';
    return nav + '<div class="sb-main">' + (section === 'local' ? localPane(state) : cloudPane(state)) + '</div>';
  }

  function onClick(event) {
    var nav = event.target.closest('[data-cc-nav]');
    if (!nav) return false;
    CC.ui.section = nav.getAttribute('data-cc-nav');
    CC.render(CC.state);
    return true;
  }

  CC.register({
    bodyClass: 'v-sidebar',
    renderBody: renderBody,
    onClick: onClick,
  });
  CC.start();
})();
