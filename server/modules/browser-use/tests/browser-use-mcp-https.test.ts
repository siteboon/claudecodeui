import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/index.js';

import { createServerForTls, resolveServerTls } from '../../../../shared/serverTls.js';
import browserUseMcpRoutes from '../browser-use-mcp.routes.js';
import { browserUseService } from '../browser-use.service.js';

/**
 * The Browser MCP subprocess calls back into this server over loopback. With SSL_CERT/SSL_KEY
 * (issue #361) the server only speaks HTTPS, so the registered URL must be https:// and the MCP
 * must trust the server's certificate even though it names a public host, not 127.0.0.1.
 */

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, '../../../..');
const MCP_SOURCE_PATH = path.join(TEST_DIRECTORY, '..', 'browser-use-mcp.ts');
const FIXTURES = path.join(REPO_ROOT, 'server', 'shared', 'tests', 'fixtures');
const CERT_PATH = path.join(FIXTURES, 'test-only-tls-cert.pem');
const KEY_PATH = path.join(FIXTURES, 'test-only-tls-key.pem');
// Same key, but issued by a private CA that is not in the file (as with mkcert or a corporate CA).
const CA_ISSUED_CERT_PATH = path.join(FIXTURES, 'test-only-tls-ca-issued-cert.pem');
const ENV_KEYS = ['DATABASE_PATH', 'SERVER_PORT', 'PORT', 'SSL_CERT', 'SSL_KEY', 'CLOUDCLI_DISABLE_SSL'] as const;

type McpRegistration = Parameters<typeof providerMcpService.addMcpServerToAllProviders>[0];

async function withIsolatedServerEnv(run: (tempDirectory: string) => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'browser-use-mcp-https-'));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    await run(tempDirectory);
  } finally {
    closeConnection();
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Runs registerAgentMcp() with the provider config writes stubbed out and returns what it registered. */
async function captureRegistration(t: test.TestContext): Promise<McpRegistration> {
  const captured: { registration?: McpRegistration } = {};
  t.mock.method(providerMcpService, 'removeMcpServerFromAllProviders', async () => []);
  t.mock.method(providerMcpService, 'addMcpServerToAllProviders', async (input: McpRegistration) => {
    captured.registration = input;
    return [];
  });
  await browserUseService.registerAgentMcp();
  assert.ok(captured.registration, 'registerAgentMcp() did not register the MCP server');
  return captured.registration;
}

/** Starts the MCP entrypoint the way an agent CLI does and sends it one tools/call request. */
async function callMcpTool(env: Record<string, string>, homeDirectory: string, toolName: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', MCP_SOURCE_PATH], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH ?? '', HOME: homeDirectory, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  try {
    const response = new Promise<Record<string, any>>((resolve, reject) => {
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        const line = stdout.split('\n').find((candidate) => candidate.includes('"id":1'));
        if (line) {
          resolve(JSON.parse(line) as Record<string, any>);
        }
      });
      child.once('exit', (code) => reject(new Error(`MCP exited with ${code}: ${stderr}`)));
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: {} },
    })}\n`);
    return await response;
  } finally {
    child.kill();
  }
}

/** Serves the real MCP API routes with SSL_CERT/SSL_KEY from process.env and points SERVER_PORT at it. */
async function startMcpApiServer(t: test.TestContext, host = '127.0.0.1'): Promise<number> {
  const app = express();
  app.use(express.json());
  app.use('/api/browser-use-mcp', browserUseMcpRoutes);
  const server = createServerForTls(resolveServerTls(process.env), app);
  server.listen(0, host);
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  process.env.SERVER_PORT = String(port);
  return port;
}

test('registers a plain http:// MCP URL without a CA when SSL is not configured', async (t) => {
  await withIsolatedServerEnv(async () => {
    process.env.SERVER_PORT = '3999';
    const registration = await captureRegistration(t);

    assert.equal(registration.env?.CLOUDCLI_BROWSER_USE_API_URL, 'http://127.0.0.1:3999/api/browser-use-mcp');
    assert.equal(registration.env?.CLOUDCLI_BROWSER_USE_API_CA_CERT, undefined);
  });
});

test('the Browser MCP reaches an HTTPS server through the URL and certificate it was registered with', { timeout: 60_000 }, async (t) => {
  await withIsolatedServerEnv(async (tempDirectory) => {
    process.env.SSL_CERT = CERT_PATH;
    process.env.SSL_KEY = KEY_PATH;
    const port = await startMcpApiServer(t);

    const registration = await captureRegistration(t);
    const env = registration.env ?? {};
    assert.equal(env.CLOUDCLI_BROWSER_USE_API_URL, `https://127.0.0.1:${port}/api/browser-use-mcp`);
    assert.equal(env.CLOUDCLI_BROWSER_USE_API_CA_CERT, CERT_PATH);
    assert.ok(env.CLOUDCLI_BROWSER_USE_MCP_TOKEN);

    const response = await callMcpTool(env, tempDirectory, 'browser_list_sessions');
    assert.equal(response.error, undefined, `MCP call failed: ${JSON.stringify(response.error)}`);
    assert.deepEqual(response.result, { content: [{ type: 'text', text: '[]' }] });
  });
});

test('the Browser MCP trusts a certificate from a private CA whose root is not in SSL_CERT', { timeout: 60_000 }, async (t) => {
  await withIsolatedServerEnv(async (tempDirectory) => {
    process.env.SSL_CERT = CA_ISSUED_CERT_PATH;
    process.env.SSL_KEY = KEY_PATH;
    await startMcpApiServer(t);

    const env = (await captureRegistration(t)).env ?? {};
    assert.equal(env.CLOUDCLI_BROWSER_USE_API_CA_CERT, CA_ISSUED_CERT_PATH);

    const response = await callMcpTool(env, tempDirectory, 'browser_list_sessions');
    assert.equal(response.error, undefined, `MCP call failed: ${JSON.stringify(response.error)}`);
    assert.deepEqual(response.result, { content: [{ type: 'text', text: '[]' }] });
  });
});

test('the Browser MCP rejects a server certificate other than the configured one', { timeout: 60_000 }, async (t) => {
  await withIsolatedServerEnv(async (tempDirectory) => {
    process.env.SSL_CERT = CERT_PATH;
    process.env.SSL_KEY = KEY_PATH;
    await startMcpApiServer(t);
    const env = (await captureRegistration(t)).env ?? {};

    // Any other certificate as the configured one: the self-signed server certificate is untrusted.
    const otherCertPath = path.join(tempDirectory, 'other-cert.pem');
    await writeFile(otherCertPath, tls.rootCertificates[0] ?? '');
    const response = await callMcpTool(
      { ...env, CLOUDCLI_BROWSER_USE_API_CA_CERT: otherCertPath },
      tempDirectory,
      'browser_list_sessions',
    );
    assert.equal(response.result, undefined);
    assert.match(String(response.error?.message), /self-signed certificate/);
  });
});

test('the Browser MCP checks the certificate name for a host outside its loopback list', { timeout: 60_000 }, async (t) => {
  await withIsolatedServerEnv(async (tempDirectory) => {
    process.env.SSL_CERT = CERT_PATH;
    process.env.SSL_KEY = KEY_PATH;
    // 127.0.0.2 reaches this machine on Linux, but is not one of the names the MCP exempts.
    let port: number;
    try {
      port = await startMcpApiServer(t, '127.0.0.2');
    } catch (error) {
      t.skip(`cannot listen on 127.0.0.2 here: ${(error as Error).message}`);
      return;
    }
    const env = (await captureRegistration(t)).env ?? {};

    const response = await callMcpTool(
      { ...env, CLOUDCLI_BROWSER_USE_API_URL: `https://127.0.0.2:${port}/api/browser-use-mcp` },
      tempDirectory,
      'browser_list_sessions',
    );
    assert.equal(response.result, undefined);
    assert.match(String(response.error?.message), /IP: 127\.0\.0\.2 is not in the cert's list/);
  });
});
