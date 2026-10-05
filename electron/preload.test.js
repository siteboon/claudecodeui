import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, it } from 'node:test';

const preloadSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'), 'utf8');

// Runs preload.cjs for a page at `url`; returns the APIs it exposed and the IPC channels they invoke.
function runPreload(url) {
  const exposed = {};
  const invoked = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (key, api) => { exposed[key] = api; } },
    ipcRenderer: {
      invoke: (channel) => { invoked.push(channel); return Promise.resolve(); },
      on: () => {},
      removeListener: () => {},
    },
  };
  const { protocol, hostname } = new URL(url);
  vm.runInNewContext(preloadSource, {
    require: (id) => {
      assert.equal(id, 'electron');
      return electron;
    },
    window: { location: { protocol, hostname } },
  });
  return { exposed, invoked };
}

describe('preload bridge', () => {
  it('gives the server actions to the launcher only', () => {
    const { exposed, invoked } = runPreload('file:///app/electron/launcher/index.html');
    assert.deepEqual(Object.keys(exposed).sort(), ['cloudcliDesktop', 'cloudcliDesktopNotifications']);
    exposed.cloudcliDesktop.connectServer('192.168.1.20:3001');
    exposed.cloudcliDesktop.openServer('id');
    exposed.cloudcliDesktop.removeServer('id');
    assert.deepEqual(invoked, ['cloudcli-desktop:connect-server', 'cloudcli-desktop:open-server', 'cloudcli-desktop:remove-server']);
  });

  it('gives Local CloudCLI and cloud pages only the notifications bridge', () => {
    for (const url of ['http://127.0.0.1:3001/', 'http://localhost:3001/', 'https://env.cloudcli.ai/']) {
      const { exposed, invoked } = runPreload(url);
      assert.deepEqual(Object.keys(exposed), ['cloudcliDesktopNotifications'], url);
      const bridge = exposed.cloudcliDesktopNotifications;
      assert.deepEqual(Object.keys(bridge).sort(), ['getState', 'onStateUpdated', 'update'], url);
      bridge.getState();
      bridge.update({ enabled: true });
      bridge.onStateUpdated(() => {});
      assert.deepEqual(invoked, ['cloudcli-desktop:get-state', 'cloudcli-desktop:update-desktop-notifications'], url);
    }
  });

  it('exposes nothing to a self-hosted server origin, should the preload ever run there', () => {
    for (const url of ['http://192.168.1.20:3001/', 'https://cloudcli.example.com/', 'https://cloudcli.ai.example.com/']) {
      assert.deepEqual(runPreload(url).exposed, {}, url);
    }
  });
});
