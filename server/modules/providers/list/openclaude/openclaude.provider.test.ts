import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { AppError } from '@/shared/utils.js';

describe('OpenClaude provider', () => {
  test('providerRegistry resolves openclaude', () => {
    const provider = providerRegistry.resolveProvider('openclaude');
    assert.equal(provider.id, 'openclaude');
  });

  test('providerRegistry.listProviders includes openclaude', () => {
    const providers = providerRegistry.listProviders();
    const ids = providers.map((p) => p.id);
    assert.ok(ids.includes('openclaude'), `Expected ids to include "openclaude", got: ${ids.join(', ')}`);
  });

  test('auth.getStatus returns expected shape', async () => {
    const provider = providerRegistry.resolveProvider('openclaude');
    const status = await provider.auth.getStatus();

    assert.equal(status.provider, 'openclaude');
    assert.equal(typeof status.installed, 'boolean');
    assert.equal(typeof status.authenticated, 'boolean');
    assert.ok('email' in status);
    assert.ok('method' in status);
  });

  test('mcp.upsertServer throws OPENCLAUDE_MCP_NOT_SUPPORTED', async () => {
    const provider = providerRegistry.resolveProvider('openclaude');
    await assert.rejects(
      provider.mcp.upsertServer({
        name: 'test',
        transport: 'stdio',
        command: 'echo',
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'OPENCLAUDE_MCP_NOT_SUPPORTED' &&
        error.statusCode === 400,
    );
  });

  test('mcp.listServers returns empty scopes', async () => {
    const provider = providerRegistry.resolveProvider('openclaude');
    const servers = await provider.mcp.listServers();
    assert.deepEqual(servers, { user: [], local: [], project: [] });
  });

  test('mcp.removeServer returns removed=false', async () => {
    const provider = providerRegistry.resolveProvider('openclaude');
    const result = await provider.mcp.removeServer({ name: 'test' });
    assert.equal(result.removed, false);
    assert.equal(result.provider, 'openclaude');
  });

  test('sessions.normalizeMessage returns empty array', () => {
    const provider = providerRegistry.resolveProvider('openclaude');
    const result = provider.sessions.normalizeMessage({}, null);
    assert.deepEqual(result, []);
  });

  test('sessions.fetchHistory returns empty result', async () => {
    const provider = providerRegistry.resolveProvider('openclaude');
    const result = await provider.sessions.fetchHistory('test-session');
    assert.equal(result.messages.length, 0);
    assert.equal(result.total, 0);
    assert.equal(result.hasMore, false);
  });

  test('sessionSynchronizer.synchronize returns 0', async () => {
    const provider = providerRegistry.resolveProvider('openclaude');
    const count = await provider.sessionSynchronizer.synchronize();
    assert.equal(count, 0);
  });

  test('sessionSynchronizer.synchronizeFile returns null', async () => {
    const provider = providerRegistry.resolveProvider('openclaude');
    const result = await provider.sessionSynchronizer.synchronizeFile('/fake/path');
    assert.equal(result, null);
  });
});
