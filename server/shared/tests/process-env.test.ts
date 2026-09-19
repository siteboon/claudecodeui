import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildProviderCliEnv } from '../utils.js';

test('buildProviderCliEnv prepends common user executable directories', () => {
  const env = { PATH: '/usr/bin' };
  const result = buildProviderCliEnv(env);
  const entries = result.PATH?.split(path.delimiter) ?? [];

  assert.equal(entries.includes(path.join(os.homedir(), '.local', 'bin')), true);
  assert.equal(entries.includes(path.join(os.homedir(), '.npm-global', 'bin')), true);
  assert.equal(entries.includes('/usr/bin'), true);
  assert.ok(entries.indexOf(path.join(os.homedir(), '.local', 'bin')) < entries.indexOf('/usr/bin'));
  assert.equal(env.PATH, '/usr/bin');
});

test('buildProviderCliEnv preserves the existing PATH key casing', () => {
  const result = buildProviderCliEnv({ Path: '/bin' });

  assert.equal(Object.keys(result).find((key) => key.toLowerCase() === 'path'), 'Path');
  assert.equal(result.PATH, undefined);
  assert.equal(result.Path?.split(path.delimiter).includes('/bin'), true);
});
