import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Issue #361 lets the server serve HTTPS from SSL_CERT/SSL_KEY. The desktop app only loads plain
 * http:// loopback servers, so it must (1) keep the server it starts on HTTP even when those
 * variables are set, and (2) not fail when a TLS server's https:// URL is in local-server.json.
 */

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, '..', '..');
const FIXTURES = path.join(REPO_ROOT, 'server', 'shared', 'tests', 'fixtures');
const RESOLVER_URL = pathToFileURL(path.join(REPO_ROOT, 'shared', 'serverTls.js')).href;

const ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'SSL_CERT',
  'SSL_KEY',
  'CLOUDCLI_DISABLE_SSL',
  'ELECTRON_SERVER_ENTRY',
  'ELECTRON_NODE_PATH',
  'ELECTRON_FORCE_OWN_SERVER',
  'ELECTRON_DEV_URL',
  'CLOUDCLI_DESKTOP_LOCAL_SERVER_URL',
  'CLOUDCLI_LOCAL_SERVER_URL',
  'ELECTRON_LOCAL_SERVER_URL',
  'CLOUDCLI_DESKTOP_LOCAL_SERVER_PORT',
  'CLOUDCLI_SERVER_PORT',
  'SERVER_PORT',
  'PORT',
];
const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'desktop-local-server-'));
for (const key of ENV_KEYS) {
  delete process.env[key];
}
// localServer.js resolves ~/.cloudcli/local-server.json when it is imported.
process.env.HOME = homeDirectory;
process.env.USERPROFILE = homeDirectory;
const { LocalServerController } = await import('../localServer.js');

// Stands in for dist-server/server/index.js: reports what the real SSL rule decides from the
// environment the desktop app gave it, and always answers /health over plain HTTP so a wrong
// decision fails the assertion instead of a 30 s readiness timeout.
const FAKE_SERVER_ENTRY = path.join(homeDirectory, 'fake-server.mjs');
await writeFile(FAKE_SERVER_ENTRY, `
import http from 'node:http';
let protocol = 'unknown';
try {
  const { resolveServerTls } = await import(${JSON.stringify(RESOLVER_URL)});
  protocol = resolveServerTls(process.env).protocol;
} catch (error) {
  protocol = 'resolver failed: ' + error.message;
}
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'ok', installMode: 'test', protocol }));
}).listen(Number(process.env.SERVER_PORT), process.env.HOST);
`);

test.after(async () => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousEnv[key];
    }
  }
  await rm(homeDirectory, { recursive: true, force: true });
});

function createController() {
  return new LocalServerController({
    appRoot: REPO_ROOT,
    settingsPath: path.join(homeDirectory, 'desktop-settings.json'),
    isPackaged: false,
    appVersion: '0.0.0-test',
  });
}

async function withStartedServer(controller, run) {
  try {
    await run();
  } finally {
    await controller.shutdownOwnedServer();
  }
}

test('the server the desktop app starts stays on HTTP when SSL_CERT/SSL_KEY are set', { timeout: 40_000 }, async () => {
  process.env.SSL_CERT = path.join(FIXTURES, 'test-only-tls-cert.pem');
  process.env.SSL_KEY = path.join(FIXTURES, 'test-only-tls-key.pem');
  process.env.ELECTRON_SERVER_ENTRY = FAKE_SERVER_ENTRY;
  process.env.ELECTRON_NODE_PATH = process.execPath;
  process.env.ELECTRON_FORCE_OWN_SERVER = '1';
  const controller = createController();

  await withStartedServer(controller, async () => {
    const url = await controller.ensureLocalServer();
    assert.match(url, /^http:\/\/localhost:\d+$/);

    const health = await fetch(`${controller.getHealthCheckUrl()}/health`).then((response) => response.json());
    assert.equal(health.protocol, 'http');
  });
});

test('an https:// URL in local-server.json does not stop the desktop app from finding a server', { timeout: 40_000 }, async () => {
  delete process.env.ELECTRON_FORCE_OWN_SERVER;
  process.env.ELECTRON_SERVER_ENTRY = FAKE_SERVER_ENTRY;
  process.env.ELECTRON_NODE_PATH = process.execPath;
  await mkdir(path.join(homeDirectory, '.cloudcli'), { recursive: true });
  await writeFile(
    path.join(homeDirectory, '.cloudcli', 'local-server.json'),
    JSON.stringify({ pid: 1, host: '0.0.0.0', port: 3443, url: 'https://localhost:3443' }),
  );
  const controller = createController();

  await withStartedServer(controller, async () => {
    // Either an existing http:// server on the default port or the app's own server; never the
    // https:// marker, which the desktop window cannot load.
    const url = await controller.ensureLocalServer();
    assert.match(url, /^http:\/\/localhost:\d+$/);
    assert.ok(controller.getStartupLogs().some((line) => line.includes('Skipping https://localhost:3443')));
  });
});
