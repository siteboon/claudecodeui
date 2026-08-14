import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChildProcessEnv } from '@/shared/child-process-env.js';

test('removes DATABASE_PATH so children do not inherit this server database', () => {
  const childEnvironment = buildChildProcessEnv({
    DATABASE_PATH: '/root/.cloudcli/auth.db',
    PATH: '/usr/bin',
  });

  assert.equal(childEnvironment.DATABASE_PATH, undefined);
  assert.equal(childEnvironment.PATH, '/usr/bin');
});

test('does not mutate the source environment', () => {
  const sourceEnvironment = { DATABASE_PATH: '/root/.cloudcli/auth.db' };

  buildChildProcessEnv(sourceEnvironment);

  assert.equal(sourceEnvironment.DATABASE_PATH, '/root/.cloudcli/auth.db');
});

test('is a no-op when DATABASE_PATH is absent', () => {
  const childEnvironment = buildChildProcessEnv({ HOME: '/root', TERM: 'xterm' });

  assert.deepEqual(childEnvironment, { HOME: '/root', TERM: 'xterm' });
});
