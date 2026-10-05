import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  ServersController,
  classifyServerNavigation,
  normalizeServerUrl,
  probeServer,
} from './servers.js';

describe('normalizeServerUrl', () => {
  it('assumes http for a bare host:port', () => {
    assert.deepEqual(normalizeServerUrl('192.168.1.20:3001'), {
      url: 'http://192.168.1.20:3001',
      origin: 'http://192.168.1.20:3001',
      name: '192.168.1.20:3001',
    });
    assert.equal(normalizeServerUrl('localhost:3001').url, 'http://localhost:3001');
    assert.equal(normalizeServerUrl('[::1]:3001').url, 'http://[::1]:3001');
  });

  it('keeps https and an optional path, dropping query, hash, default port and trailing slashes', () => {
    assert.deepEqual(normalizeServerUrl('  HTTPS://CloudCLI.Example.com:443/cloudcli//?tab=chat#top  '), {
      url: 'https://cloudcli.example.com/cloudcli',
      origin: 'https://cloudcli.example.com',
      name: 'cloudcli.example.com',
    });
    assert.equal(normalizeServerUrl('http://example.com/').url, 'http://example.com');
    assert.equal(normalizeServerUrl('http:/192.168.1.20:3001').url, 'http://192.168.1.20:3001', 'one slash typed');
    assert.equal(normalizeServerUrl('cloudcli.local:').url, 'http://cloudcli.local');
  });

  it('rejects empty input, other schemes, embedded credentials and malformed addresses', () => {
    assert.throws(() => normalizeServerUrl('   '), /Enter the address/);
    for (const address of ['file:///etc/passwd', 'ftp://example.com', 'ws://example.com:3001', 'javascript://example.com/%0Aalert(1)', 'javascript:alert(1)', 'mailto:a@example.com']) {
      assert.throws(() => normalizeServerUrl(address), /Only http:\/\/ and https:\/\//, address);
    }
    assert.throws(() => normalizeServerUrl('https://user:secret@example.com'), /Remove the username and password/);
    assert.throws(() => normalizeServerUrl('192.168.1.20:99999'), /not a valid server address/);
    assert.throws(() => normalizeServerUrl('http://exa mple.com'), /not a valid server address/);
  });
});

describe('classifyServerNavigation', () => {
  const origin = 'http://192.168.1.20:3001';

  it('keeps same-origin navigations in the tab', () => {
    assert.equal(classifyServerNavigation('http://192.168.1.20:3001/session/abc?x=1', origin), 'allow');
  });

  it('sends other web origins, including another port or scheme of the same host, to the browser', () => {
    assert.equal(classifyServerNavigation('https://github.com/siteboon/claudecodeui', origin), 'external');
    assert.equal(classifyServerNavigation('http://192.168.1.20:5173/', origin), 'external');
    assert.equal(classifyServerNavigation('https://192.168.1.20:3001/', origin), 'external');
  });

  it('never hands non-web schemes to the OS', () => {
    for (const url of ['cloudcli://auth/callback?api_key=x', 'file:///etc/passwd', 'vscode://file/x', 'javascript:alert(1)', 'not a url']) {
      assert.equal(classifyServerNavigation(url, origin), 'block', url);
    }
  });

  it('allows nothing when the saved origin is unknown', () => {
    assert.equal(classifyServerNavigation('http://192.168.1.20:3001/', null), 'external');
  });
});

describe('probeServer', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/api/auth/status' || req.url === '/proxied/api/auth/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ needsSetup: false, isAuthenticated: false }));
        return;
      }
      if (req.url === '/html/api/auth/status') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><title>Router login</title>');
        return;
      }
      if (req.url === '/stall/api/auth/status') {
        return; // never answers
      }
      if (req.url === '/broken/api/auth/status') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ needsSetup: false, isAuthenticated: false }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  it('accepts a CloudCLI server, also behind a path prefix', async () => {
    assert.deepEqual(await probeServer(baseUrl), { needsSetup: false, isAuthenticated: false });
    assert.equal((await probeServer(`${baseUrl}/proxied/`)).needsSetup, false);
  });

  it('reports a server that answers but is not CloudCLI', async () => {
    await assert.rejects(probeServer(`${baseUrl}/html`), /responded, but it does not look like a CloudCLI server/);
    await assert.rejects(probeServer(`${baseUrl}/missing`), /responded with HTTP 404, but it does not look like a CloudCLI server/);
    await assert.rejects(probeServer(`${baseUrl}/broken`), /responded with HTTP 500/, 'an error status fails even with a CloudCLI body');
  });

  // Fails instead of hanging if the probe stops aborting a silent server.
  it('reports an unreachable or silent server', { timeout: 5000 }, async () => {
    const closed = http.createServer();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedUrl = `http://127.0.0.1:${closed.address().port}`;
    await new Promise((resolve) => closed.close(resolve));

    await assert.rejects(probeServer(closedUrl), /^Error: Could not reach 127\.0\.0\.1:\d+ \(.+\)\. Check the address/);
    await assert.rejects(
      probeServer(`${baseUrl}/stall`, { timeoutMs: 200 }),
      /Could not reach 127\.0\.0\.1:\d+ \(no response after \d+ seconds\)/,
    );
  });
});

describe('ServersController', () => {
  let tmpDir;
  let storePath;
  const cloudCliFetch = async () => new Response(JSON.stringify({ needsSetup: false, isAuthenticated: false }), { status: 200 });

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-servers-'));
    storePath = path.join(tmpDir, 'nested', 'desktop-servers.json');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('saves a probed server, persists it, and does not duplicate a saved address', async () => {
    const probed = [];
    let changes = 0;
    const controller = new ServersController({
      storePath,
      fetchImpl: async (url, options) => {
        probed.push(url);
        return cloudCliFetch(url, options);
      },
      onChange: () => { changes += 1; },
    });
    await controller.load();
    assert.deepEqual(controller.getServers(), []);

    const server = await controller.addServer('192.168.1.20:3001/');
    assert.equal(server.url, 'http://192.168.1.20:3001');
    assert.equal(server.name, '192.168.1.20:3001');
    assert.match(server.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(probed, ['http://192.168.1.20:3001/api/auth/status']);
    assert.equal(changes, 1);

    const again = await controller.addServer('http://192.168.1.20:3001');
    assert.equal(again.id, server.id);
    assert.equal(probed.length, 1, 'a saved address is not probed again');
    assert.deepEqual(controller.getOrigins(), ['http://192.168.1.20:3001']);

    const reloaded = new ServersController({ storePath });
    await reloaded.load();
    assert.deepEqual(reloaded.getServers(), controller.getServers());
    assert.equal(reloaded.findServer(server.id).url, 'http://192.168.1.20:3001');
  });

  it('does not save a server that fails the probe', async () => {
    const controller = new ServersController({
      storePath,
      fetchImpl: async () => new Response('<html></html>', { status: 200 }),
    });
    await controller.load();
    const before = controller.getServers().length;
    await assert.rejects(controller.addServer('https://router.example.com'), /does not look like a CloudCLI server/);
    await assert.rejects(controller.addServer('ftp://router.example.com'), /Only http/);
    assert.equal(controller.getServers().length, before);

    const reloaded = new ServersController({ storePath });
    await reloaded.load();
    assert.equal(reloaded.getServers().length, before);
  });

  it('removes a server and persists the removal', async () => {
    const controller = new ServersController({ storePath, fetchImpl: cloudCliFetch });
    await controller.load();
    const server = await controller.addServer('https://cloudcli.example.com');
    assert.equal((await controller.removeServer(server.id)).id, server.id);
    assert.equal(await controller.removeServer('missing'), null);
    assert.equal(controller.findServer(server.id), null);

    const reloaded = new ServersController({ storePath });
    await reloaded.load();
    assert.equal(reloaded.findServer(server.id), null);
  });

  it('uses the origin of a server behind a path prefix for permissions', async () => {
    const controller = new ServersController({ storePath: path.join(tmpDir, 'prefixed.json'), fetchImpl: cloudCliFetch });
    await controller.load();
    await controller.addServer('https://cloudcli.example.com/cloudcli/');
    assert.equal(controller.getServers()[0].url, 'https://cloudcli.example.com/cloudcli');
    assert.deepEqual(controller.getOrigins(), ['https://cloudcli.example.com']);
  });

  it('keeps every entry when adds and removes overlap', async () => {
    const concurrentStore = path.join(tmpDir, 'concurrent.json');
    // Every probe answers after the same delay, so the adds are all in flight at once.
    const slowFetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return cloudCliFetch();
    };
    const controller = new ServersController({ storePath: concurrentStore, fetchImpl: slowFetch });
    await controller.load();

    const [first, second, sameAsFirst] = await Promise.all([
      controller.addServer('10.0.0.1:3001'),
      controller.addServer('10.0.0.2:3001'),
      controller.addServer('http://10.0.0.1:3001/'),
    ]);
    assert.equal(sameAsFirst.id, first.id, 'the same address added twice at once is saved once');
    const urls = ['http://10.0.0.1:3001', 'http://10.0.0.2:3001'];
    assert.deepEqual(controller.getServers().map((server) => server.url), urls);

    const reloaded = new ServersController({ storePath: concurrentStore });
    await reloaded.load();
    assert.deepEqual(reloaded.getServers().map((server) => server.url), urls);

    await Promise.all([controller.removeServer(first.id), controller.removeServer(second.id), controller.addServer('10.0.0.3:3001')]);
    await reloaded.load();
    assert.deepEqual(reloaded.getServers().map((server) => server.url), ['http://10.0.0.3:3001']);
    assert.deepEqual(controller.getServers(), reloaded.getServers());
  });

  it('drops unreadable or unsafe entries from the store file', async () => {
    const badStore = path.join(tmpDir, 'bad.json');
    await fs.writeFile(badStore, JSON.stringify({
      servers: [
        { id: 'ok', url: 'HTTP://Example.com:8080/', name: 'ignored', addedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'scheme', url: 'javascript:alert(1)' },
        { id: 'file', url: 'file:///etc/passwd' },
        { id: 'creds', url: 'http://a:b@example.com' },
        { url: 'http://no-id.example.com' },
        'garbage',
      ],
    }));
    const controller = new ServersController({ storePath: badStore });
    await controller.load();
    assert.deepEqual(controller.getServers(), [
      { id: 'ok', name: 'example.com:8080', url: 'http://example.com:8080', addedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    await fs.writeFile(badStore, '{not json');
    await controller.load();
    assert.deepEqual(controller.getServers(), []);
  });
});
