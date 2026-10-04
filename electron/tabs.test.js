import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TabsController } from './tabs.js';

describe('TabsController', () => {
  it('gives every saved server its own tab', () => {
    const tabs = new TabsController();
    const home = { kind: 'server', id: 'home-mac', name: '192.168.1.20:3001', url: 'http://192.168.1.20:3001' };
    const vps = { kind: 'server', id: 'vps', name: 'cloudcli.example.com', url: 'https://cloudcli.example.com' };

    assert.equal(tabs.getTabIdForTarget(home), 'server:home-mac');
    tabs.upsertTarget(home);
    tabs.upsertTarget(vps);
    tabs.upsertTarget({ kind: 'remote', id: 'home-mac', name: 'cloud env', url: 'https://env.cloudcli.ai' });

    assert.deepEqual(
      tabs.getSerializableTabs().map(({ id, title, kind }) => ({ id, title, kind })),
      [
        { id: 'home', title: 'Launcher', kind: 'launcher' },
        { id: 'server:home-mac', title: '192.168.1.20:3001', kind: 'server' },
        { id: 'server:vps', title: 'cloudcli.example.com', kind: 'server' },
        { id: 'remote:home-mac', title: 'cloud env', kind: 'remote' },
      ],
    );
    assert.equal(tabs.removeByKind('remote').length, 1, 'logging out of the cloud account keeps server tabs');
    assert.equal(tabs.getTab('server:vps').target.url, 'https://cloudcli.example.com');
  });
});
