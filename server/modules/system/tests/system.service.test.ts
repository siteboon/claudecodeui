import assert from 'node:assert/strict';
import test from 'node:test';

import { createSystemUpdateService } from '../system.service.js';

type SystemUpdateDependencies = Parameters<typeof createSystemUpdateService>[0];

function createDependencies(
  overrides: Partial<SystemUpdateDependencies> = {},
): SystemUpdateDependencies {
  return {
    appRoot: '/app/cloudcli',
    homeDirectory: '/home/cloudcli',
    installMode: 'git',
    isPlatform: false,
    environment: { TEST_ENVIRONMENT: 'true' },
    runShellCommand: async () => ({ exitCode: 0, output: 'updated', errorOutput: '' }),
    createDirectory: async () => undefined,
    moveDirectory: async () => undefined,
    removeDirectory: async () => undefined,
    pathExists: async () => true,
    logInfo: () => undefined,
    logError: () => undefined,
    ...overrides,
  };
}

test('git installations update from the application root', async () => {
  const calls: unknown[][] = [];
  const dependencies = createDependencies({
    runShellCommand: async (command, workingDirectory, environment) => {
      calls.push([command, workingDirectory, environment]);
      return { exitCode: 0, output: 'git update complete', errorOutput: '' };
    },
  });
  const service = createSystemUpdateService(dependencies);

  const result = await service.updateSystem();

  assert.deepEqual(calls, [[
    'git checkout main && git pull && npm install',
    '/app/cloudcli',
    dependencies.environment,
  ]]);
  assert.deepEqual(result, {
    success: true,
    output: 'git update complete',
    message: 'Update completed. Please restart the server to apply changes.',
  });
});

const NPM_APP_ROOT = '/usr/lib/node_modules/@cloudcli-ai/cloudcli';
const NPM_STAGING_ROOT = '/usr/lib/node_modules/@cloudcli-ai/.cloudcli-update';
const NPM_STAGED_APP = `${NPM_STAGING_ROOT}/node_modules/@cloudcli-ai/cloudcli`;
const NPM_PREVIOUS_APP = '/usr/lib/node_modules/@cloudcli-ai/.cloudcli-previous';

function createNpmDependencies(
  calls: unknown[][],
  overrides: Partial<SystemUpdateDependencies> = {},
): SystemUpdateDependencies {
  return createDependencies({
    appRoot: NPM_APP_ROOT,
    installMode: 'npm',
    runShellCommand: async (command, workingDirectory) => {
      calls.push(['run', command, workingDirectory]);
      return { exitCode: 0, output: '', errorOutput: '' };
    },
    createDirectory: async (directory) => { calls.push(['mkdir', directory]); },
    moveDirectory: async (from, to) => { calls.push(['move', from, to]); },
    removeDirectory: async (directory) => { calls.push(['remove', directory]); },
    ...overrides,
  });
}

test('global npm installations stage the new version before replacing the running one', async () => {
  const calls: unknown[][] = [];
  const service = createSystemUpdateService(createNpmDependencies(calls));

  const result = await service.updateSystem();

  assert.deepEqual(calls, [
    ['remove', NPM_STAGING_ROOT],
    ['mkdir', NPM_STAGING_ROOT],
    ['run', 'npm install --prefix . --install-strategy=shallow --no-save --no-package-lock @cloudcli-ai/cloudcli@latest', NPM_STAGING_ROOT],
    ['remove', NPM_PREVIOUS_APP],
    ['move', NPM_APP_ROOT, NPM_PREVIOUS_APP],
    ['move', NPM_STAGED_APP, NPM_APP_ROOT],
    ['remove', NPM_STAGING_ROOT],
    ['remove', NPM_PREVIOUS_APP],
  ]);
  assert.equal(result.success, true);
  assert.equal(result.output, 'Update completed successfully');
});

test('an npm install outside a global node_modules folder keeps the plain global install', async () => {
  const calls: unknown[][] = [];
  const service = createSystemUpdateService(createNpmDependencies(calls, {
    appRoot: '/Applications/CloudCLI.app/Contents/Resources/app',
    homeDirectory: '/home/user',
  }));

  const result = await service.updateSystem();

  assert.deepEqual(calls, [['run', 'npm install -g @cloudcli-ai/cloudcli@latest', '/home/user']]);
  assert.equal(result.success, true);
});

test('a cleanup that fails after the swap still reports the update as done', async () => {
  const calls: unknown[][] = [];
  let swapped = false;
  const service = createSystemUpdateService(createNpmDependencies(calls, {
    moveDirectory: async (from, to) => {
      calls.push(['move', from, to]);
      if (to === NPM_APP_ROOT) swapped = true;
    },
    removeDirectory: async (directory) => {
      calls.push(['remove', directory]);
      if (swapped) throw new Error('EACCES');
    },
  }));

  const result = await service.updateSystem();

  assert.equal(result.success, true);
  assert.deepEqual(calls.slice(-2), [['remove', NPM_STAGING_ROOT], ['remove', NPM_PREVIOUS_APP]]);
});

test('a failed or killed npm install leaves the running installation untouched', async () => {
  const calls: unknown[][] = [];
  const service = createSystemUpdateService(createNpmDependencies(calls, {
    runShellCommand: async () => ({ exitCode: 137, output: 'added 300 packages', errorOutput: 'Killed' }),
  }));

  const result = await service.updateSystem();

  assert.equal(result.success, false);
  assert.equal(calls.some(([operation]) => operation === 'move'), false);
});

test('an update after a failed restore keeps the backup and moves the new version in', async () => {
  const calls: unknown[][] = [];
  const service = createSystemUpdateService(createNpmDependencies(calls, {
    // The earlier swap lost the app directory; only the backup holds the working version.
    pathExists: async (target) => target !== NPM_APP_ROOT,
  }));

  await service.updateSystem();

  const moves = calls.filter(([operation]) => operation === 'move');
  assert.deepEqual(moves, [['move', NPM_STAGED_APP, NPM_APP_ROOT]]);
  assert.equal(calls.filter(([operation, target]) => operation === 'remove' && target === NPM_PREVIOUS_APP).length, 1, 'only the cleanup after the swap removes the backup');
});

test('a failed swap restores the previous installation', async () => {
  const calls: unknown[][] = [];
  const service = createSystemUpdateService(createNpmDependencies(calls, {
    moveDirectory: async (from, to) => {
      calls.push(['move', from, to]);
      if (from === NPM_STAGED_APP) {
        throw new Error('EXDEV: cross-device link not permitted');
      }
    },
  }));

  const result = await service.updateSystem();

  assert.deepEqual(result, { success: false, error: 'EXDEV: cross-device link not permitted' });
  assert.deepEqual(calls.filter(([operation]) => operation === 'move'), [
    ['move', NPM_APP_ROOT, NPM_PREVIOUS_APP],
    ['move', NPM_STAGED_APP, NPM_APP_ROOT],
    ['move', NPM_PREVIOUS_APP, NPM_APP_ROOT],
  ]);
});

test('background updates report progress and never run twice at once', async () => {
  let finishCommand: (result: { exitCode: number; output: string; errorOutput: string }) => void = () => undefined;
  let runs = 0;
  const service = createSystemUpdateService(createDependencies({
    runShellCommand: () => {
      runs += 1;
      return new Promise((resolve) => { finishCommand = resolve; });
    },
  }));

  assert.deepEqual(service.getUpdateStatus(), { running: false, result: null });
  service.startUpdate();
  service.startUpdate();
  assert.deepEqual(service.getUpdateStatus(), { running: true, result: null });

  finishCommand({ exitCode: 0, output: 'done', errorOutput: '' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runs, 1);
  assert.deepEqual(service.getUpdateStatus(), {
    running: false,
    result: {
      success: true,
      output: 'done',
      message: 'Update completed. Please restart the server to apply changes.',
    },
  });
});

test('platform installations use the platform workflow regardless of install mode', async () => {
  const calls: unknown[][] = [];
  const dependencies = createDependencies({
    installMode: 'npm',
    isPlatform: true,
    runShellCommand: async (command, workingDirectory, environment) => {
      calls.push([command, workingDirectory, environment]);
      return { exitCode: 0, output: 'platform update complete', errorOutput: '' };
    },
  });
  const service = createSystemUpdateService(dependencies);

  await service.updateSystem();

  assert.deepEqual(calls, [[
    'npm run update:platform',
    '/app/cloudcli',
    dependencies.environment,
  ]]);
});

test('failed update commands retain stdout and stderr for the existing API contract', async () => {
  const service = createSystemUpdateService(createDependencies({
    runShellCommand: async () => ({
      exitCode: 1,
      output: 'installing',
      errorOutput: 'npm failed',
    }),
  }));

  assert.deepEqual(await service.updateSystem(), {
    success: false,
    error: 'Update command failed',
    output: 'installing',
    errorOutput: 'npm failed',
  });
});

test('process startup errors retain their message for the existing API contract', async () => {
  const service = createSystemUpdateService(createDependencies({
    runShellCommand: async () => {
      throw new Error('spawn sh failed');
    },
  }));

  assert.deepEqual(await service.updateSystem(), {
    success: false,
    error: 'spawn sh failed',
  });
});
