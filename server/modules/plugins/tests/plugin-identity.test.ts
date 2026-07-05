import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  buildPluginIdentityEnv,
  buildPluginIdentityHeaders,
} from '@/modules/plugins/plugin-identity.js';

test('plugin identity headers use upstream payload/signature contract', () => {
  const previousSecret = process.env.PLUGIN_IDENTITY_SECRET;
  process.env.PLUGIN_IDENTITY_SECRET = 'root-secret';
  const user = { id: 42, username: 'stefan' };
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);

  try {
    const headers = buildPluginIdentityHeaders('notes', user, now);
    const payloadJson = Buffer.from(headers['x-plugin-user-payload'], 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson) as { userId: string; username: string; iat: number };
    const pluginKey = crypto.createHmac('sha256', 'root-secret').update('plugin:notes').digest();
    const expectedSignature = crypto.createHmac('sha256', pluginKey).update(payloadJson).digest('hex');

    assert.deepEqual(payload, { userId: '42', username: 'stefan', iat: 1767225600 });
    assert.equal(headers['x-plugin-user-algorithm'], 'sha256');
    assert.equal(headers['x-plugin-user-signature'], `sha256=${expectedSignature}`);
    assert.equal(headers['x-plugin-user-id'], undefined);
    assert.equal(headers['x-plugin-user-name'], undefined);
    assert.equal(headers['x-plugin-user-iat'], undefined);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.PLUGIN_IDENTITY_SECRET;
    } else {
      process.env.PLUGIN_IDENTITY_SECRET = previousSecret;
    }
  }
});

test('plugin identity key is deterministic and scoped to a plugin', () => {
  const previousSecret = process.env.PLUGIN_IDENTITY_SECRET;
  process.env.PLUGIN_IDENTITY_SECRET = 'root-secret';

  try {
    const notesEnv = buildPluginIdentityEnv('notes');
    const terminalEnv = buildPluginIdentityEnv('terminal');
    const expectedKey = crypto.createHmac('sha256', 'root-secret').update('plugin:notes').digest('hex');

    assert.deepEqual(notesEnv, { PLUGIN_IDENTITY_KEY: expectedKey });
    assert.notEqual(notesEnv.PLUGIN_IDENTITY_KEY, terminalEnv.PLUGIN_IDENTITY_KEY);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.PLUGIN_IDENTITY_SECRET;
    } else {
      process.env.PLUGIN_IDENTITY_SECRET = previousSecret;
    }
  }
});

test('plugin identity headers are omitted without an authenticated user', () => {
  assert.deepEqual(buildPluginIdentityHeaders('notes', null), {});
});
