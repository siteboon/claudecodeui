import assert from 'node:assert/strict';

import { OpenClaudeProvider } from '@/modules/providers/list/openclaude/openclaude.provider.js';
import { AppError } from '@/shared/utils.js';

test('OpenClaudeProvider instantiates with correct id', () => {
  const provider = new OpenClaudeProvider();
  assert.equal(provider.id, 'openclaude');
});

test('OpenClaudeProvider.auth.getStatus returns status object', async () => {
  const provider = new OpenClaudeProvider();
  const status = await provider.auth.getStatus();
  assert.equal(status.provider, 'openclaude');
  assert.equal(typeof status.installed, 'boolean');
  assert.equal(typeof status.authenticated, 'boolean');
});

test('OpenClaudeProvider.mcp.listServers returns empty scopes', async () => {
  const provider = new OpenClaudeProvider();
  const servers = await provider.mcp.listServers();
  assert.deepEqual(servers, { user: [], local: [], project: [] });
});

test('OpenClaudeProvider.mcp.upsertServer throws not supported', async () => {
  const provider = new OpenClaudeProvider();
  await assert.rejects(
    () => provider.mcp.upsertServer({ name: 'test', scope: 'user', transport: 'stdio', command: 'echo' }),
    (err: unknown) => err instanceof AppError && err.code === 'OPENCLAUDE_MCP_NOT_SUPPORTED',
  );
});

test('OpenClaudeProvider.sessions.normalizeMessage handles text event', () => {
  const provider = new OpenClaudeProvider();
  const raw = { type: 'assistant', subtype: 'text', content: 'Hello from OCC' };
  const messages = provider.sessions.normalizeMessage(raw, 'test-session');
  assert.ok(messages.length > 0);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].content, 'Hello from OCC');
  assert.equal(messages[0].provider, 'openclaude');
});

test('OpenClaudeProvider.sessions.normalizeMessage handles tool_use event', () => {
  const provider = new OpenClaudeProvider();
  const raw = {
    type: 'assistant',
    subtype: 'tool_use',
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/test.txt' },
    tool_use_id: 'tu_123',
  };
  const messages = provider.sessions.normalizeMessage(raw, 'test-session');
  assert.ok(messages.length > 0);
  assert.equal(messages[0].kind, 'tool_use');
  assert.equal(messages[0].toolName, 'Read');
});

test('OpenClaudeProvider.sessions.normalizeMessage returns empty for unknown events', () => {
  const provider = new OpenClaudeProvider();
  const messages = provider.sessions.normalizeMessage({ type: 'unknown_garbage' }, 'test-session');
  assert.deepEqual(messages, []);
});
