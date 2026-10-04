import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import test from 'node:test';

import { getConnectableHost, getListenHost, getViteListenHost } from '../../../shared/networkHosts.js';

/**
 * HOST unset (issue #399) has to make the backend and the Vite dev server accept IPv4 and IPv6
 * connections on every interface, falling back to IPv4 when the machine has no IPv6. Explicit HOST
 * values are honored exactly; the desktop app, for one, passes 127.0.0.1 or 0.0.0.0.
 *
 * The socket tests listen the way startServer() in server/index.ts does:
 * `server.listen(port, getListenHost(process.env.HOST))`.
 */

async function startHttpServer(host: string | undefined): Promise<http.Server> {
  const server = http.createServer((_request, response) => response.end('ok'));
  server.listen(0, host);
  await once(server, 'listening');
  return server;
}

async function stopHttpServer(server: http.Server): Promise<void> {
  server.close();
  await once(server, 'close');
}

function getPort(server: http.Server): number {
  return (server.address() as AddressInfo).port;
}

// Resolves with the HTTP status, or with the error code (e.g. ECONNREFUSED) when the connection fails.
function requestStatus(address: string, port: number, timeoutMs = 2000): Promise<number | string> {
  return new Promise((resolve) => {
    const request = http.get({ host: address, port, path: '/', agent: false, timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
  });
}

// Windows retries a refused connection for about 2 s before it reports ECONNREFUSED, which races the
// default timeout above, so the refusal checks wait longer. Elsewhere the refusal comes back at once.
const REFUSED_TIMEOUT_MS = 10_000;

async function canListenOn(host: string): Promise<boolean> {
  try {
    await stopHttpServer(await startHttpServer(host));
    return true;
  } catch {
    return false;
  }
}

const IPV6_LOOPBACK_SKIP = (await canListenOn('::1')) ? false : 'this machine has no IPv6 loopback (::1)';

// A non-loopback IPv4 address of this machine, to tell "every interface" apart from "loopback only".
const LAN_IPV4_ADDRESS = Object.values(os.networkInterfaces())
  .flat()
  .find((networkInterface) => networkInterface?.family === 'IPv4' && !networkInterface.internal)?.address;
const LAN_IPV4_SKIP = LAN_IPV4_ADDRESS ? false : 'this machine has no non-loopback IPv4 address';

test('leaves the listen host out when HOST is unset or empty', () => {
  assert.equal(getListenHost(undefined), undefined);
  assert.equal(getListenHost(''), undefined);
});

test('passes an explicit HOST through unchanged', () => {
  for (const host of ['0.0.0.0', '::', '127.0.0.1', '::1', 'localhost', '192.168.1.20', 'my-host.lan']) {
    assert.equal(getListenHost(host), host);
  }
});

test('never turns a wildcard listen host into a browser URL host', () => {
  assert.equal(getConnectableHost(getListenHost(undefined)), 'localhost');
  assert.equal(getConnectableHost(getListenHost('::')), 'localhost');
  assert.equal(getConnectableHost(getListenHost('0.0.0.0')), 'localhost');
});

test('lets Vite leave the listen host out when HOST is unset or empty', () => {
  // `true`, not '::' or '0.0.0.0': only a listen() without a host is dual-stack with an IPv4 fallback.
  assert.equal(getViteListenHost(undefined), true);
  assert.equal(getViteListenHost(''), true);
});

test('passes an explicit HOST to Vite, with loopback addresses as localhost', () => {
  for (const host of ['0.0.0.0', '::', '192.168.1.20', 'my-host.lan']) {
    assert.equal(getViteListenHost(host), host);
  }
  for (const host of ['127.0.0.1', '::1', 'localhost']) {
    assert.equal(getViteListenHost(host), 'localhost');
  }
});

type ViteConfigFactory = (env: { mode: string; command: string }) => { server: { host?: unknown } };

// Runs vite.config.js with a HOST value and returns the `server.host` it gives Vite. The config is
// imported through a runtime URL so tsc does not pull it (and Vite's types) into the server build.
async function getViteConfigHost(host: string): Promise<unknown> {
  const viteConfigUrl = new URL('../../../vite.config.js', import.meta.url).href;
  const { default: createViteConfig } = (await import(viteConfigUrl)) as { default: ViteConfigFactory };
  const previousHost = process.env.HOST;
  process.env.HOST = host;
  try {
    return createViteConfig({ mode: 'test', command: 'serve' }).server.host;
  } finally {
    if (previousHost === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = previousHost;
    }
  }
}

test('vite.config.js hands Vite the listen host for HOST', async () => {
  // Vite prefers process.env over .env files, so an empty HOST stands in for an unset one even
  // when a local .env sets HOST.
  assert.equal(await getViteConfigHost(''), true);
  assert.equal(await getViteConfigHost('0.0.0.0'), '0.0.0.0');
  assert.equal(await getViteConfigHost('::'), '::');
  assert.equal(await getViteConfigHost('127.0.0.1'), 'localhost');
});

test('HOST unset accepts IPv4 and IPv6 loopback connections', { skip: IPV6_LOOPBACK_SKIP }, async () => {
  const server = await startHttpServer(getListenHost(undefined));
  try {
    assert.equal(await requestStatus('127.0.0.1', getPort(server)), 200);
    assert.equal(await requestStatus('::1', getPort(server)), 200);
    assert.equal((server.address() as AddressInfo).address, '::');
  } finally {
    await stopHttpServer(server);
  }
});

test('HOST unset accepts IPv4 connections on non-loopback interfaces', { skip: LAN_IPV4_SKIP }, async () => {
  const server = await startHttpServer(getListenHost(undefined));
  try {
    assert.equal(await requestStatus(LAN_IPV4_ADDRESS as string, getPort(server)), 200);
  } finally {
    await stopHttpServer(server);
  }
});

// Node's internal TCP handle binding. listen() calls TCP.prototype.bind6() to bind an IPv6 address.
type TcpWrapBinding = { TCP?: { prototype: { bind6?: (...args: unknown[]) => number } } };

function getTcpHandlePrototype() {
  try {
    return (process as unknown as { binding(name: string): TcpWrapBinding }).binding('tcp_wrap').TCP?.prototype;
  } catch {
    return undefined;
  }
}

test('HOST unset falls back to IPv4 when IPv6 is unavailable', async (t) => {
  // Node's own fallback for a listen() without a host: it first binds `::` and, when that fails,
  // binds 0.0.0.0. Make the IPv6 bind fail the way it does on a kernel without IPv6.
  const tcpPrototype = getTcpHandlePrototype();
  const originalBind6 = tcpPrototype?.bind6;
  if (!tcpPrototype || typeof originalBind6 !== 'function') {
    t.skip('this Node version does not expose tcp_wrap through process.binding');
    return;
  }

  tcpPrototype.bind6 = () => -os.constants.errno.EAFNOSUPPORT;
  let server: http.Server;
  try {
    server = await startHttpServer(getListenHost(undefined));
  } finally {
    tcpPrototype.bind6 = originalBind6;
  }
  try {
    assert.equal((server.address() as AddressInfo).address, '0.0.0.0');
    assert.equal(await requestStatus('127.0.0.1', getPort(server)), 200);
  } finally {
    await stopHttpServer(server);
  }
});

test('HOST=0.0.0.0 stays IPv4-only', { skip: IPV6_LOOPBACK_SKIP }, async () => {
  const server = await startHttpServer(getListenHost('0.0.0.0'));
  try {
    assert.equal(await requestStatus('127.0.0.1', getPort(server)), 200);
    assert.equal(await requestStatus('::1', getPort(server), REFUSED_TIMEOUT_MS), 'ECONNREFUSED');
  } finally {
    await stopHttpServer(server);
  }
});

test('HOST=:: accepts IPv4 and IPv6 loopback connections', { skip: IPV6_LOOPBACK_SKIP }, async () => {
  const server = await startHttpServer(getListenHost('::'));
  try {
    assert.equal(await requestStatus('127.0.0.1', getPort(server)), 200);
    assert.equal(await requestStatus('::1', getPort(server)), 200);
  } finally {
    await stopHttpServer(server);
  }
});

test('HOST=127.0.0.1 stays on the IPv4 loopback', async (t) => {
  const server = await startHttpServer(getListenHost('127.0.0.1'));
  try {
    assert.equal((server.address() as AddressInfo).address, '127.0.0.1');
    assert.equal(await requestStatus('127.0.0.1', getPort(server)), 200);
    if (!IPV6_LOOPBACK_SKIP) {
      assert.equal(await requestStatus('::1', getPort(server), REFUSED_TIMEOUT_MS), 'ECONNREFUSED');
    }
    if (LAN_IPV4_ADDRESS) {
      assert.equal(await requestStatus(LAN_IPV4_ADDRESS, getPort(server), REFUSED_TIMEOUT_MS), 'ECONNREFUSED');
    } else {
      t.diagnostic('no non-loopback IPv4 address to check');
    }
  } finally {
    await stopHttpServer(server);
  }
});
