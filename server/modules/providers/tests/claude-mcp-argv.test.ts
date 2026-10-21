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
 *
 * The copy also cost time on every message: Claude CLI 2.1.303 makes the
 * first API call of a turn wait until each `--mcp-config` server has
 * connected, while servers it loads itself connect in the background (#1576).
 * Follow-up turns resume in a new CLI process, so they are checked too.
 */

const ENV_SECRET = 'SENTINEL-ENV-1211';
const HEADER_SECRET = 'Bearer SENTINEL-HDR-1211';
const LOCAL_SECRET = 'SENTINEL-LOCAL-1211';
const PROJECT_SECRET = 'SENTINEL-PROJECT-1211';

test('MCP servers configured in ~/.claude.json or .mcp.json never reach the SDK options', async () => {
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
  await writeFile(path.join(cwd, '.mcp.json'), JSON.stringify({
    mcpServers: { 'project-with-env': { type: 'stdio', command: 'node', env: { API_TOKEN: PROJECT_SECRET } } },
  }));

  const capturedOptions: AnyRecord[] = [];
  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
    capturedOptions.push(options);
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
  // The first turn starts a conversation; the second resumes it, as every
  // follow-up message in Chat does.
  let nativeSessionId: string | null = null;
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => nativeSessionId,
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
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    await queryClaudeSDK('hello', { sessionId: 'app-mcp-argv', cwd }, writer as never, context);
    nativeSessionId = 'native-mcp-argv';
    await queryClaudeSDK('hello again', { sessionId: 'app-mcp-argv', cwd }, writer as never, context);
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }

  assert.equal(capturedOptions.length, 2, 'the runtime handed options to the SDK on both turns');
  assert.equal(capturedOptions[0].resume, undefined);
  assert.equal(capturedOptions[1].resume, 'native-mcp-argv');
  for (const [turn, options] of capturedOptions.entries()) {
    assert.equal(options.mcpServers, undefined, `turn ${turn + 1}: no servers are passed for the SDK to put on the CLI argv`);
    assert.equal(options.extraArgs?.['mcp-config'], undefined, `turn ${turn + 1}: no --mcp-config argument either`);
    // --strict-mcp-config would make the CLI ignore every server in the user's config.
    assert.notEqual(options.strictMcpConfig, true, `turn ${turn + 1}: the user's own servers stay enabled`);
    const serialized = JSON.stringify(options);
    for (const secret of [ENV_SECRET, HEADER_SECRET, LOCAL_SECRET, PROJECT_SECRET]) {
      assert.ok(!serialized.includes(secret), `turn ${turn + 1}: ${secret} must not appear in the SDK options`);
    }
    // The CLI still loads those servers itself from the user's own config.
    assert.deepEqual(options.settingSources, ['project', 'user', 'local']);
  }
});
