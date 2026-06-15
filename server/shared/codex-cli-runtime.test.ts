import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCodexRuntimeEnv,
  getCodexShellCommand,
  resolveCodexExecutablePath,
  type ResolveCodexExecutablePathDependencies,
} from '@/shared/codex-cli-runtime.js';

const POSIX_PATH_DELIMITER = ':';

function createExistsSync(paths: string[]): ResolveCodexExecutablePathDependencies['existsSync'] {
  const existing = new Set(paths);
  return ((candidate: string) => existing.has(candidate)) as ResolveCodexExecutablePathDependencies['existsSync'];
}

test('resolveCodexExecutablePath prefers the user npm-global install over app-local PATH entries', () => {
  const globalCodexPath = '/home/devuser/.npm-global/bin/codex';
  const localCodexPath = '/opt/claudecodeui/node_modules/.bin/codex';

  const resolved = resolveCodexExecutablePath(undefined, {
    env: {
      NPM_CONFIG_PREFIX: '/home/devuser/.npm-global',
      PATH: `/opt/claudecodeui/node_modules/.bin${POSIX_PATH_DELIMITER}/usr/bin`,
    },
    existsSync: createExistsSync([globalCodexPath, localCodexPath]),
    homedir: () => '/home/devuser',
    platform: 'linux',
  });

  assert.equal(resolved, globalCodexPath);
});

test('resolveCodexExecutablePath skips node_modules bin when a non-local PATH codex exists', () => {
  const localCodexPath = '/opt/claudecodeui/node_modules/.bin/codex';
  const pathCodexPath = '/usr/local/bin/codex';

  const resolved = resolveCodexExecutablePath(undefined, {
    env: {
      PATH: `/opt/claudecodeui/node_modules/.bin${POSIX_PATH_DELIMITER}/usr/local/bin`,
    },
    existsSync: createExistsSync([localCodexPath, pathCodexPath]),
    homedir: () => '/home/devuser',
    platform: 'linux',
  });

  assert.equal(resolved, pathCodexPath);
});

test('resolveCodexExecutablePath falls back to app-local codex when it is the only install', () => {
  const localCodexPath = '/opt/claudecodeui/node_modules/.bin/codex';

  const resolved = resolveCodexExecutablePath(undefined, {
    env: {
      PATH: `/opt/claudecodeui/node_modules/.bin${POSIX_PATH_DELIMITER}/usr/bin`,
    },
    existsSync: createExistsSync([localCodexPath]),
    homedir: () => '/home/devuser',
    platform: 'linux',
  });

  assert.equal(resolved, localCodexPath);
});

test('createCodexRuntimeEnv prepends the selected Codex directory to PATH', () => {
  const runtimeEnv = createCodexRuntimeEnv(
    {
      NPM_CONFIG_PREFIX: '/home/devuser/.npm-global',
      PATH: `/opt/claudecodeui/node_modules/.bin${POSIX_PATH_DELIMITER}/usr/bin`,
    },
    {
      existsSync: createExistsSync(['/home/devuser/.npm-global/bin/codex']),
      homedir: () => '/home/devuser',
      platform: 'linux',
    }
  );

  assert.equal(
    runtimeEnv.PATH,
    `/home/devuser/.npm-global/bin${POSIX_PATH_DELIMITER}/opt/claudecodeui/node_modules/.bin${POSIX_PATH_DELIMITER}/usr/bin`
  );
});

test('getCodexShellCommand quotes explicit executable paths for shell launches', () => {
  const command = getCodexShellCommand({
    env: {
      CODEX_CLI_PATH: "/home/devuser/bin/codex with space",
    },
    existsSync: createExistsSync([]),
    homedir: () => '/home/devuser',
    platform: 'linux',
  });

  assert.equal(command, "'/home/devuser/bin/codex with space'");
});
