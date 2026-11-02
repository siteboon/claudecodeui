import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { AnyRecord, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * The SDK turns `options.mcpServers` into a `--mcp-config <json>` argument on
 * the Claude CLI's command line, which any local user can read through `ps` or
 * /proc/<pid>/cmdline. The CLI already loads the servers in ~/.claude.json on
 * its own (the runtime sets `settingSources`), so the runtime must never copy
 * them, secrets included, into the options it hands the SDK.
 */

const ENV_SECRET = 'SENTINEL-ENV-1211';
const HEADER_SECRET = 'Bearer SENTINEL-HDR-1211';
const LOCAL_SECRET = 'SENTINEL-LOCAL-1211';

test('MCP servers configured in ~/.claude.json never reach the SDK options', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'claude-mcp-argv-home-'));
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-mcp-argv-cwd-'));
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      'stdio-with-env': { type: 'stdio', command: 'node', args: ['server.js'], env: { API_TOKEN: ENV_SECRET } },
      'http-with-headers': { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: HEADER_SECRET } },
    },
    projects: {
      [cwd]: { mcpServers: { 'local-with-env': { type: 'stdio', command: 'node', env: { API_TOKEN: LOCAL_SECRET } } } },
    },
  }));

  let capturedOptions: AnyRecord | null = null;
  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
    capturedOptions = options;
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
    })();
    const messages = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'native-mcp-argv' };
      yield { type: 'result', subtype: 'success', session_id: 'native-mcp-argv', result: 'ok', duration_ms: 1, num_turns: 1 };
    })();
    return Object.assign(messages, { interrupt: async () => {} });
  };

  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };
  const writer = { send: () => {}, userId: null };

  // os.homedir() follows HOME (USERPROFILE on Windows), so the runtime sees the temp config.
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    await queryClaudeSDK('hello', { sessionId: 'app-mcp-argv', cwd }, writer as never, context);
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }

  assert.ok(capturedOptions, 'the runtime handed options to the SDK');
  const options = capturedOptions as AnyRecord;
  assert.equal(options.mcpServers, undefined, 'no servers are passed for the SDK to put on the CLI argv');
  const serialized = JSON.stringify(options);
  for (const secret of [ENV_SECRET, HEADER_SECRET, LOCAL_SECRET]) {
    assert.ok(!serialized.includes(secret), `${secret} must not appear in the SDK options`);
  }
  // The CLI still loads those servers itself from the user's own config.
  assert.deepEqual(options.settingSources, ['project', 'user', 'local']);
});
