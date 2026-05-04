import assert from 'node:assert/strict';

import { CrewAIProvider } from '@/modules/providers/list/crewai/crewai.provider.js';
import { AppError } from '@/shared/utils.js';

test('CrewAIProvider instantiates with correct id', () => {
  const provider = new CrewAIProvider();
  assert.equal(provider.id, 'crewai');
});

test('CrewAIProvider.auth.getStatus returns status object', async () => {
  const provider = new CrewAIProvider();
  const status = await provider.auth.getStatus();
  assert.equal(status.provider, 'crewai');
  assert.equal(typeof status.installed, 'boolean');
  assert.equal(typeof status.authenticated, 'boolean');
});

test('CrewAIProvider.mcp.listServers returns empty scopes', async () => {
  const provider = new CrewAIProvider();
  const servers = await provider.mcp.listServers();
  assert.deepEqual(servers, { user: [], local: [], project: [] });
});

test('CrewAIProvider.mcp.upsertServer throws not supported', async () => {
  const provider = new CrewAIProvider();
  await assert.rejects(
    () => provider.mcp.upsertServer({ name: 'test', scope: 'user', transport: 'stdio', command: 'echo' }),
    (err: unknown) => err instanceof AppError && err.code === 'CREWAI_MCP_NOT_SUPPORTED',
  );
});

test('CrewAIProvider.sessions.normalizeMessage handles crew status event', () => {
  const provider = new CrewAIProvider();
  const raw = { type: 'status', message: 'Starting crew run...' };
  const messages = provider.sessions.normalizeMessage(raw, 'test-session');
  assert.ok(messages.length > 0);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].provider, 'crewai');
});

test('CrewAIProvider.sessions.normalizeMessage handles crew result event', () => {
  const provider = new CrewAIProvider();
  const raw = { type: 'result', output: 'The analysis is complete.' };
  const messages = provider.sessions.normalizeMessage(raw, 'test-session');
  assert.ok(messages.length > 0);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].content, 'The analysis is complete.');
});

test('CrewAIProvider.sessions.normalizeMessage handles crew error event', () => {
  const provider = new CrewAIProvider();
  const raw = { type: 'error', message: 'Crew execution failed' };
  const messages = provider.sessions.normalizeMessage(raw, 'test-session');
  assert.ok(messages.length > 0);
  assert.equal(messages[0].kind, 'error');
});

test('CrewAIProvider.sessions.normalizeMessage returns empty for unknown', () => {
  const provider = new CrewAIProvider();
  const messages = provider.sessions.normalizeMessage({ type: 'garbage' }, 'test-session');
  assert.deepEqual(messages, []);
});
