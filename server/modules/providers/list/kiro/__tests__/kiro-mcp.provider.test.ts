/**
 * Real end-to-end MCP CRUD tests for KiroMcpProvider.
 *
 * Writes to a real on-disk JSON file under a tmp-dir override of $HOME and
 * asserts the round-trip through `upsertServer` -> `listServersForScope`.
 * Specifically validates the issue uncovered in code review:
 *   - `disabled` and `autoApprove` Kiro-specific fields are PRESERVED across
 *     upserts (they were being silently wiped).
 *   - HTTP transport with bearerTokenEnvVar is written and read back.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// We intercept HOME to point at a fresh tmp dir so the provider writes there.
// Capture the original env vars (not os.homedir()) so teardown restores HOME
// and USERPROFILE independently — they are not guaranteed to match.
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-mcp-test-'));

// homedir() reads from the env on Linux, so override it before importing the
// provider (which captures path joins lazily inside instance methods).
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;

const { KiroMcpProvider } = await import('@/modules/providers/list/kiro/kiro-mcp.provider.js');

const SETTINGS_FILE = path.join(TMP_HOME, '.kiro', 'settings', 'mcp.json');

function writeSettings(content: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(content, null, 2));
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
}

describe('KiroMcpProvider', () => {
  before(() => {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  });

  after(() => {
    if (ORIGINAL_HOME !== undefined) {
      process.env.HOME = ORIGINAL_HOME;
    } else {
      delete process.env.HOME;
    }
    if (ORIGINAL_USERPROFILE !== undefined) {
      process.env.USERPROFILE = ORIGINAL_USERPROFILE;
    } else {
      delete process.env.USERPROFILE;
    }
    fs.rmSync(TMP_HOME, { recursive: true, force: true });
  });

  it('lists existing user-scope stdio servers', async () => {
    writeSettings({
      mcpServers: {
        fetch: {
          command: 'uvx',
          args: ['mcp-server-fetch'],
          env: { FOO: 'bar' },
          disabled: true,
          autoApprove: ['*'],
        },
      },
    });

    const provider = new KiroMcpProvider();
    const list = await provider.listServersForScope('user');
    assert.equal(list.length, 1);
    assert.equal(list[0].provider, 'kiro');
    assert.equal(list[0].name, 'fetch');
    assert.equal(list[0].transport, 'stdio');
    assert.equal(list[0].command, 'uvx');
    assert.deepEqual(list[0].args, ['mcp-server-fetch']);
    assert.deepEqual(list[0].env, { FOO: 'bar' });
  });

  it('preserves disabled=true on upsert (regression: user disable was being wiped)', async () => {
    writeSettings({
      mcpServers: {
        broken: {
          command: 'old-bin',
          args: [],
          env: {},
          disabled: true,
          autoApprove: ['risky_tool'],
        },
      },
    });

    const provider = new KiroMcpProvider();
    await provider.upsertServer({
      name: 'broken',
      scope: 'user',
      transport: 'stdio',
      command: 'new-bin', // user is updating the binary path
      args: ['--flag'],
      env: { NEW: '1' },
    });

    const after = readSettings();
    const broken = (after.mcpServers as Record<string, Record<string, unknown>>).broken;

    // New canonical fields took effect
    assert.equal(broken.command, 'new-bin');
    assert.deepEqual(broken.args, ['--flag']);
    assert.deepEqual(broken.env, { NEW: '1' });
    // CRITICAL: Kiro-only fields were preserved
    assert.equal(broken.disabled, true);
    assert.deepEqual(broken.autoApprove, ['risky_tool']);
  });

  it('preserves autoApprove without disabled', async () => {
    writeSettings({
      mcpServers: {
        partial: {
          command: 'a',
          args: [],
          env: {},
          autoApprove: ['t1', 't2'],
        },
      },
    });

    const provider = new KiroMcpProvider();
    await provider.upsertServer({
      name: 'partial',
      scope: 'user',
      transport: 'stdio',
      command: 'b',
      args: [],
      env: {},
    });

    const after = readSettings();
    const partial = (after.mcpServers as Record<string, Record<string, unknown>>).partial;
    assert.deepEqual(partial.autoApprove, ['t1', 't2']);
    assert.equal(partial.disabled, undefined, 'must not invent a disabled field');
  });

  it('writes bearer_token_env_var for HTTP transports', async () => {
    writeSettings({ mcpServers: {} });

    const provider = new KiroMcpProvider();
    await provider.upsertServer({
      name: 'token-protected',
      scope: 'user',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { 'X-Custom': 'value' },
      bearerTokenEnvVar: 'MY_TOKEN',
    });

    const after = readSettings();
    const entry = (after.mcpServers as Record<string, Record<string, unknown>>)['token-protected'];
    assert.equal(entry.url, 'https://example.com/mcp');
    assert.deepEqual(entry.headers, { 'X-Custom': 'value' });
    assert.equal(entry.bearer_token_env_var, 'MY_TOKEN');
  });

  it('listServersForScope reads bearer_token_env_var back as bearerTokenEnvVar', async () => {
    writeSettings({
      mcpServers: {
        api: {
          url: 'https://api.example.com/mcp',
          headers: {},
          bearer_token_env_var: 'API_TOKEN',
        },
      },
    });

    const provider = new KiroMcpProvider();
    const list = await provider.listServersForScope('user');
    assert.equal(list.length, 1);
    assert.equal(list[0].transport, 'http');
    assert.equal(list[0].url, 'https://api.example.com/mcp');
    assert.equal(list[0].bearerTokenEnvVar, 'API_TOKEN');
  });

  it('removes a server', async () => {
    writeSettings({
      mcpServers: {
        keep: { command: 'a', args: [] },
        drop: { command: 'b', args: [] },
      },
    });

    const provider = new KiroMcpProvider();
    const result = await provider.removeServer({ name: 'drop', scope: 'user' });
    assert.equal(result.removed, true);

    const after = readSettings();
    assert.deepEqual(Object.keys(after.mcpServers as object), ['keep']);
  });

  it('rejects unsupported scope (e.g. "local")', async () => {
    const provider = new KiroMcpProvider();
    // KiroMcpProvider was constructed with ['user', 'project'] only; 'local'
    // is a valid `McpScope` in the type system but unsupported at runtime.
    const invalidInput = { name: 'x', scope: 'local', transport: 'stdio', command: 'whatever' } as Parameters<typeof provider.upsertServer>[0];
    await assert.rejects(provider.upsertServer(invalidInput), (err: Error) => err.message.length > 0);
  });
});
