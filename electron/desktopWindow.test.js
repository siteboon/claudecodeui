import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';

// Needs `node --test --experimental-test-module-mocks` (see the test:desktop script).
const defaultSession = {
  setPermissionRequestHandler(handler) { this.requestHandler = handler; },
  setPermissionCheckHandler(handler) { this.checkHandler = handler; },
};
const unused = {};
mock.module('electron', {
  namedExports: {
    BrowserView: class {},
    BrowserWindow: class {},
    Menu: unused,
    Tray: class {},
    clipboard: unused,
    dialog: unused,
    nativeImage: unused,
    nativeTheme: unused,
    session: { defaultSession },
    webContents: unused,
  },
});
const { DesktopWindowManager } = await import('./desktopWindow.js');

describe('DesktopWindowManager permissions', () => {
  const savedOrigin = 'http://192.168.1.20:3001';

  before(() => {
    const manager = new DesktopWindowManager({
      appName: 'CloudCLI',
      getCloudState: () => ({ controlPlaneUrl: 'https://cloudcli.ai' }),
      getServerOrigins: () => [savedOrigin],
      actions: { showError: () => {} },
    });
    manager.configurePermissions();
  });

  const page = (url) => ({ getURL: () => url });
  // What the request handler answers, as Electron calls it for a permission prompt.
  function request(url, permission, details = {}) {
    let answer;
    defaultSession.requestHandler(page(url), permission, (granted) => { answer = granted; }, details);
    return answer;
  }
  const check = (url, permission, details = {}) => defaultSession.checkHandler(page(url), permission, savedOrigin, details);

  it('gives a saved server origin the short list Local CloudCLI and cloud tabs get', () => {
    for (const permission of ['notifications', 'clipboard-read']) {
      assert.equal(request(`${savedOrigin}/session/abc`, permission), true, permission);
      assert.equal(check(`${savedOrigin}/`, permission), true, permission);
    }
    assert.equal(request(`${savedOrigin}/`, 'media', { mediaTypes: ['audio'] }), true, 'microphone for voice input');
    assert.equal(check(`${savedOrigin}/`, 'media', { mediaType: 'audio' }), true);
  });

  it('denies a saved server origin the camera and anything outside the list', () => {
    assert.equal(request(`${savedOrigin}/`, 'media', { mediaTypes: ['video'] }), false);
    assert.equal(request(`${savedOrigin}/`, 'media', { mediaTypes: ['audio', 'video'] }), false);
    assert.equal(check(`${savedOrigin}/`, 'media', { mediaType: 'video' }), false);
    for (const permission of ['geolocation', 'midi', 'openExternal', 'clipboard-sanitized-write', 'pointerLock']) {
      assert.equal(request(`${savedOrigin}/`, permission), false, permission);
      assert.equal(check(`${savedOrigin}/`, permission), false, permission);
    }
  });

  it('grants nothing to origins that are not saved', () => {
    for (const url of ['http://192.168.1.21:3001/', 'https://192.168.1.20:3001/', 'http://192.168.1.20:3002/', 'https://example.com/']) {
      assert.equal(request(url, 'notifications'), false, url);
      assert.equal(request(url, 'media', { mediaTypes: ['audio'] }), false, url);
      assert.equal(check(url, 'clipboard-read'), false, url);
    }
    assert.equal(defaultSession.checkHandler(null, 'notifications', savedOrigin, {}), false);
  });

  it('keeps the camera for Local CloudCLI and cloud environments', () => {
    for (const url of ['http://127.0.0.1:3001/', 'http://localhost:3001/', 'https://env.cloudcli.ai/']) {
      assert.equal(request(url, 'media', { mediaTypes: ['audio', 'video'] }), true, url);
      assert.equal(request(url, 'notifications'), true, url);
      assert.equal(request(url, 'geolocation'), false, url);
    }
  });
});
