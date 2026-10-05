import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, it, mock } from 'node:test';

// Needs `node --test --experimental-test-module-mocks` (see the test:desktop script).
class FakeWebContents extends EventEmitter {
  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }
}

class FakeBrowserView {
  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
  }
}

mock.module('electron', { namedExports: { BrowserView: FakeBrowserView, dialog: {} } });
const { ViewHost } = await import('./viewHost.js');

describe('ViewHost', () => {
  let opened;
  let host;

  beforeEach(() => {
    opened = [];
    host = new ViewHost({
      appName: 'CloudCLI',
      getMainWindow: () => null,
      getContentViewBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      getPreloadPath: () => '/app/electron/preload.cjs',
      openExternalUrl: async (url) => { opened.push(url); },
      showError: () => {},
    });
  });

  const serverTarget = { kind: 'server', id: 'home', name: '192.168.1.20:3001', url: 'http://192.168.1.20:3001/cloudcli' };

  // Emits will-navigate the way Electron does and reports whether the tab cancelled it.
  function navigate(webContents, url) {
    let prevented = false;
    webContents.emit('will-navigate', { url, preventDefault: () => { prevented = true; } });
    return prevented;
  }

  it('gives server tabs no preload, so their pages get no desktop bridge', () => {
    const server = host.getOrCreateTabView('server:home', serverTarget);
    const local = host.getOrCreateTabView('local', { kind: 'local', name: 'Local CloudCLI', url: 'http://127.0.0.1:3001' });
    const cloud = host.getOrCreateTabView('remote:env', { kind: 'remote', id: 'env', name: 'env', url: 'https://env.cloudcli.ai' });

    assert.equal('preload' in server.options.webPreferences, false);
    assert.equal(local.options.webPreferences.preload, '/app/electron/preload.cjs');
    assert.equal(cloud.options.webPreferences.preload, '/app/electron/preload.cjs');
    for (const view of [server, local, cloud]) {
      assert.equal(view.options.webPreferences.sandbox, true);
      assert.equal(view.options.webPreferences.contextIsolation, true);
      assert.equal(view.options.webPreferences.nodeIntegration, false);
    }
  });

  it('keeps a server tab on the saved origin and hands only web links to the browser', () => {
    const { webContents } = host.getOrCreateTabView('server:home', serverTarget);

    assert.equal(navigate(webContents, 'http://192.168.1.20:3001/session/abc'), false, 'same origin stays in the tab');
    assert.equal(navigate(webContents, 'http://192.168.1.20:3001/'), false, 'also outside the saved path');
    assert.equal(navigate(webContents, 'https://github.com/siteboon/claudecodeui'), true);
    assert.equal(navigate(webContents, 'http://192.168.1.20:5173/'), true, 'another port is another origin');
    for (const url of ['cloudcli://auth/callback?api_key=x', 'file:///etc/passwd', 'vscode://file/x', 'javascript:alert(1)']) {
      assert.equal(navigate(webContents, url), true, url);
    }
    assert.deepEqual(opened, ['https://github.com/siteboon/claudecodeui', 'http://192.168.1.20:5173/']);
  });

  it('opens only http(s) window.open targets of a server tab, always outside the app', () => {
    const { webContents } = host.getOrCreateTabView('server:home', serverTarget);
    const urls = [
      'https://github.com/siteboon/claudecodeui',
      'http://192.168.1.20:3001/session/abc',
      'cloudcli://auth/callback?api_key=x',
      'file:///etc/passwd',
      'blob:http://192.168.1.20:3001/0b1c',
      'not a url',
    ];
    for (const url of urls) {
      assert.deepEqual(webContents.windowOpenHandler({ url }), { action: 'deny' }, url);
    }
    assert.deepEqual(opened, ['https://github.com/siteboon/claudecodeui', 'http://192.168.1.20:3001/session/abc']);
  });

  it('leaves navigation and window.open of local and cloud tabs as they were', () => {
    const { webContents } = host.getOrCreateTabView('local', { kind: 'local', name: 'Local CloudCLI', url: 'http://127.0.0.1:3001' });

    assert.equal(webContents.listenerCount('will-navigate'), 0);
    assert.deepEqual(webContents.windowOpenHandler({ url: 'https://github.com/siteboon/claudecodeui' }), { action: 'deny' });
    assert.deepEqual(opened, ['https://github.com/siteboon/claudecodeui']);
  });
});
