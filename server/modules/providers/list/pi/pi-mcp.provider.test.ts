import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PiMcpProvider } from '@/modules/providers/list/pi/pi-mcp.provider.js';
import { AppError } from '@/shared/utils.js';

const ALL_SCOPES = ['user', 'local', 'project'] as const;

test('T26: listServers returns a complete grouping with an empty array per scope', async () => {
  const provider = new PiMcpProvider();
  const grouped = await provider.listServers();

  assert.deepEqual(Object.keys(grouped).sort(), [...ALL_SCOPES].sort());
  for (const scope of ALL_SCOPES) {
    assert.deepEqual(grouped[scope], []);
  }
});

test('T26: listServersForScope returns an empty array for every scope', async () => {
  const provider = new PiMcpProvider();
  for (const scope of ALL_SCOPES) {
    assert.deepEqual(await provider.listServersForScope(scope), []);
  }
});

test('T26: upsertServer throws ERR-PROVIDER-CAPABILITY-UNSUPPORTED', async () => {
  const provider = new PiMcpProvider();
  await assert.rejects(
    () => provider.upsertServer({ name: 'x', transport: 'stdio', command: 'foo' }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROVIDER_CAPABILITY_UNSUPPORTED');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});

test('T26: removeServer throws ERR-PROVIDER-CAPABILITY-UNSUPPORTED', async () => {
  const provider = new PiMcpProvider();
  await assert.rejects(
    () => provider.removeServer({ name: 'x' }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROVIDER_CAPABILITY_UNSUPPORTED');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});
