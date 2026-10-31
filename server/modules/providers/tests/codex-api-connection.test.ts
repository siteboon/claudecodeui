import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';

import { createCodexApiConnectionService } from '@/modules/providers/services/codex-api-connection.service.js';

function createService() {
  const values = new Map<string, string>();
  return createCodexApiConnectionService({ get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); } });
}

test('API settings never return the key, retain it on blank updates and can be removed', () => {
  const service = createService();
  assert.throws(() => service.save({ baseUrl: 'https://example.com/v1' }), /API key/);
  assert.deepEqual(service.save({ baseUrl: 'https://example.com/v1/', apiKey: 'test-secret' }), {
    provider: 'custom-api', baseUrl: 'https://example.com/v1', hasApiKey: true,
  });
  assert(!JSON.stringify(service.getPublic()).includes('test-secret'));
  service.save({ baseUrl: 'https://other.example/v1', apiKey: '' });
  assert.equal(service.getSdkOptions()?.apiKey, 'test-secret');
  assert.equal(service.getSdkOptions()?.config?.model_provider, 'custom-api');
  assert.equal(service.getPublic().baseUrl, 'https://other.example/v1');
  assert.deepEqual(service.clear(), { provider: 'custom-api', baseUrl: '', hasApiKey: false });
  assert.equal(service.getSdkOptions(), undefined);
});

test('invalid endpoints and multiline keys leave the existing settings intact', () => {
  const service = createService();
  service.save({ baseUrl: 'https://example.com/v1', apiKey: 'existing-key' });
  for (const baseUrl of ['invalid', 'file:///tmp/test', 'https://user:secret@example.com', 'https://example.com?key=secret', 'https://example.com/#fragment']) {
    assert.throws(() => service.save({ baseUrl, apiKey: 'replacement' }));
  }
  assert.throws(() => service.save({ baseUrl: 'https://example.com/v1', apiKey: 'first\nsecond' }));
  assert.equal(service.getSdkOptions()?.apiKey, 'existing-key');
});

test('provider IDs are configurable, retained on updates and validated without overwriting settings', () => {
  const service = createService();
  service.save({ provider: 'aicode', baseUrl: 'https://example.com/v1', apiKey: 'test-key' });
  service.save({ baseUrl: 'https://example.com/v1' });
  assert.equal(service.getPublic().provider, 'aicode');
  service.save({ provider: 'my-api_2', baseUrl: 'https://example.com/v1' });
  assert.equal(service.getSdkOptions()?.config?.model_provider, 'my-api_2');
  for (const provider of ['', 'openai', 'bad.id', 'bad key', '$(touch /tmp/bad)', 'a\ninvalid']) {
    assert.throws(() => service.save({ provider, baseUrl: 'https://example.com/v1' }));
  }
  assert.equal(service.getPublic().provider, 'my-api_2');
});

test('legacy saved connections use the default custom provider when none was saved', () => {
  const values = new Map([['codex_api_connection', JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'legacy-key' })]]);
  const service = createCodexApiConnectionService({ get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); } });
  assert.equal(service.getPublic().provider, 'custom-api');
  service.save({ baseUrl: 'https://other.example/v1' });
  assert.equal(JSON.parse(values.get('codex_api_connection')!).provider, 'custom-api');
});

test('real Codex sends the configured key to the configured endpoint without auth.json', { timeout: 30000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-codex-api-'));
  const configPath = path.join(directory, 'config.toml');
  const originalConfig = 'model_provider = "unrelated"\n[model_providers.unrelated]\nname = "Other"\nbase_url = "http://127.0.0.1:1/v1"\nwire_api = "responses"\n';
  await writeFile(configPath, originalConfig);
  let requestPath: string | undefined;
  let authorization: string | undefined;
  let requestBody = '';
  const server = http.createServer((request, response) => {
    requestPath = request.url;
    authorization = request.headers.authorization;
    requestBody = '';
    request.on('data', chunk => { requestBody += chunk.toString(); });
    request.on('end', () => {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'LOCAL_TEST_STOP', type: 'invalid_request_error' } }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const service = createService();
    service.save({ provider: 'my-api_2', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: 'local-only-test-key' });
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    const codex = new Codex({
      ...service.getSdkOptions(),
      codexPathOverride: process.env.CLOUDCLI_CODEX_PATH || undefined,
      env: { ...env, CODEX_HOME: directory },
    });
    const thread = codex.startThread({ workingDirectory: directory, skipGitRepoCheck: true, model: 'gpt-5.4', approvalPolicy: 'never', sandboxMode: 'read-only' });
    await assert.rejects(thread.run('Reply with OK.', { signal: AbortSignal.timeout(15000) }), /LOCAL_TEST_STOP/);
    assert.equal(requestPath, '/v1/responses');
    assert.equal(authorization, 'Bearer local-only-test-key');
    assert.ok(thread.id, 'Codex must announce its native thread id');
    const resumed = codex.resumeThread(thread.id, {
      workingDirectory: directory, skipGitRepoCheck: true, model: 'gpt-5.4',
      approvalPolicy: 'never', sandboxMode: 'read-only',
    });
    await assert.rejects(resumed.run('Continue the previous conversation.', { signal: AbortSignal.timeout(15000) }), /LOCAL_TEST_STOP/);
    assert.equal(resumed.id, thread.id);
    assert.equal(authorization, 'Bearer local-only-test-key');
    assert(requestBody.includes('Reply with OK.'), 'Resuming must send the original prompt as context');
    assert(requestBody.includes('Continue the previous conversation.'));
    if (process.platform !== 'win32') {
      t.mock.method(os, 'homedir', () => directory);
      const shellEnvironment = service.getShellEnvironment(env.PATH)!;
      const launcher = await readFile(path.join(shellEnvironment.PATH.split(path.delimiter)[0], 'codex'), 'utf8');
      assert(!launcher.includes('local-only-test-key'));
      assert.equal(shellEnvironment.CLOUDCLI_CODEX_PROVIDER, 'my-api_2');
      requestPath = undefined;
      authorization = undefined;
      // Exercise the same bare `codex` command a user types in the web terminal.
      const child = spawn('/bin/bash', ['-c', 'codex exec --json --skip-git-repo-check --sandbox read-only --model gpt-5.4 -'], {
        cwd: directory,
        env: { ...env, ...shellEnvironment, CODEX_HOME: directory },
        signal: AbortSignal.timeout(15000),
      });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.stdout.resume();
      child.stdin.end('Reply with OK.');
      const [code] = await once(child, 'exit');
      assert.equal(code, 1, stderr);
      assert.equal(requestPath, '/v1/responses', stderr);
      assert.equal(authorization, 'Bearer local-only-test-key');
      service.clear();
      assert.equal(service.getShellEnvironment(env.PATH), undefined);
    }
    await assert.rejects(readFile(path.join(directory, 'auth.json')), { code: 'ENOENT' });
    assert.equal(await readFile(configPath, 'utf8'), originalConfig);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
