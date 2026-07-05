import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPluginIdentityHeaders } from '@/modules/plugins/plugin-identity.js';

test('plugin identity headers are deterministic and scoped to plugin and user', () => {
  const user = { id: 42, username: 'stefan' };
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);

  const first = buildPluginIdentityHeaders('notes', user, now);
  const second = buildPluginIdentityHeaders('notes', user, now);
  const differentPlugin = buildPluginIdentityHeaders('terminal', user, now);

  assert.deepEqual(first, second);
  assert.equal(first['x-plugin-user-id'], '42');
  assert.equal(first['x-plugin-user-name'], 'stefan');
  assert.equal(first['x-plugin-user-iat'], '1767225600');
  assert.notEqual(first['x-plugin-user-signature'], differentPlugin['x-plugin-user-signature']);
});

test('plugin identity headers are omitted without an authenticated user', () => {
  assert.deepEqual(buildPluginIdentityHeaders('notes', null), {});
});
