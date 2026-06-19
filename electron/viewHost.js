import { BrowserView } from 'electron';

const TARGET_LOAD_TIMEOUT_MS = 20000;

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

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function loadUrlWithTimeout(webContents, url, timeoutMs = TARGET_LOAD_TIMEOUT_MS) {
  let timedOut = false;
  let timeout = null;
  const loadPromise = webContents.loadURL(url);
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      try {
        webContents.stop();
      } catch {
        // Ignore teardown races while reporting the original timeout.
      }
      reject(new Error(`Timed out loading ${url} after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
  });

  try {
    await Promise.race([loadPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      loadPromise.catch(() => {});
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class ViewHost {
  constructor({ appName, getMainWindow, getContentViewBounds, getPreloadPath, openExternalUrl, showError }) {
    this.appName = appName;
    this.getMainWindow = getMainWindow;
    this.getContentViewBounds = getContentViewBounds;
    this.getPreloadPath = getPreloadPath;
    this.openExternalUrl = openExternalUrl;
    this.showError = showError;
    this.activeContentView = null;
    this.tabViews = new Map();
  }

  configureChildWebContents(webContents) {
    webContents.setWindowOpenHandler(({ url }) => {
      void this.openExternalUrl(url).catch((error) => this.showError('Could not open external link', error));
      return { action: 'deny' };
    });
  }

  detachAll() {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      for (const view of mainWindow.getBrowserViews()) {
        mainWindow.removeBrowserView(view);
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

  attach(view) {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (this.activeContentView && this.activeContentView !== view) {
      this.detachAll();
    }
    this.activeContentView = view;
    try {
      if (!mainWindow.getBrowserViews().includes(view)) {
        mainWindow.addBrowserView(view);
      }
    } catch {
      return;
    }
    view.setBounds(this.getContentViewBounds());
    view.setAutoResize({ width: true, height: true });
  }

  resizeActiveView() {
    if (this.activeContentView) {
      this.activeContentView.setBounds(this.getContentViewBounds());
    }
  }

  async showTabPlaceholder(tabId, target, message) {
    const view = this.getOrCreateTabView(tabId);
    this.attach(view);
    const html = buildPlaceholderHtml(target.name || this.appName, message);
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    view.__cloudcliStartupHtml = html;
    view.__cloudcliLoadedUrl = null;
  }

  async showLocalStartupTarget(tabId, target, logs) {
    const view = this.getOrCreateTabView(tabId);
    if (view.__cloudcliLoadingUrl) return;
    this.attach(view);
    const html = buildPlaceholderHtml(target.name || this.appName, 'Starting Local CloudCLI...', logs);
    if (view.__cloudcliStartupHtml === html) return;
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    view.__cloudcliStartupHtml = html;
    view.__cloudcliLoadedUrl = null;
  }

  async showContentTarget(tabId, target) {
    if (!isHttpUrl(target.url)) {
      throw new Error(`Refusing to load unsupported app URL: ${target.url}`);
    }
    const view = this.getOrCreateTabView(tabId);
    this.attach(view);
    if (view.__cloudcliLoadedUrl !== target.url) {
      view.__cloudcliLoadingUrl = target.url;
      try {
        await loadUrlWithTimeout(view.webContents, target.url);
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
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (mainWindow.getBrowserViews().includes(view)) {
          mainWindow.removeBrowserView(view);
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

  clear() {
    this.tabViews.clear();
    this.activeContentView = null;
  }
}
