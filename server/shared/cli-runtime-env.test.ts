import assert from 'node:assert/strict';
import test from 'node:test';

import { createUserShellRuntimeEnv } from '@/shared/cli-runtime-env.js';

const POSIX_PATH_DELIMITER = ':';

test('createUserShellRuntimeEnv prepends user CLI bins before app-local npm bins', () => {
  const runtimeEnv = createUserShellRuntimeEnv(
    {
      NPM_CONFIG_PREFIX: '/home/devuser/.npm-global',
      PATH: `/opt/claudecodeui/node_modules/.bin${POSIX_PATH_DELIMITER}/usr/bin`,
    },
    {
      homedir: () => '/home/devuser',
      platform: 'linux',
    }
  );

  assert.equal(
    runtimeEnv.PATH,
    [
      '/home/devuser/.npm-global/bin',
      '/home/devuser/.local/bin',
      '/opt/claudecodeui/node_modules/.bin',
      '/usr/bin',
    ].join(POSIX_PATH_DELIMITER)
  );
});

test('createUserShellRuntimeEnv does not duplicate existing user CLI path entries', () => {
  const runtimeEnv = createUserShellRuntimeEnv(
    {
      PATH: [
        '/home/devuser/.npm-global/bin',
        '/opt/claudecodeui/node_modules/.bin',
        '/usr/bin',
      ].join(POSIX_PATH_DELIMITER),
    },
    {
      homedir: () => '/home/devuser',
      platform: 'linux',
    }
  );

  assert.equal(
    runtimeEnv.PATH,
    [
      '/home/devuser/.local/bin',
      '/home/devuser/.npm-global/bin',
      '/opt/claudecodeui/node_modules/.bin',
      '/usr/bin',
    ].join(POSIX_PATH_DELIMITER)
  );
});
