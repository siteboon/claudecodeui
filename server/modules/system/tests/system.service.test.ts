import assert from 'node:assert/strict';
import test from 'node:test';

import type { SystemServerStartRecord, SystemUpdateRecord } from '@/shared/types.js';

import { createRecordedUpdateRunner, createSystemUpdateService } from '../system.service.js';

type SystemUpdateDependencies = Parameters<typeof createSystemUpdateService>[0];

function createUpdateHistory(lastStart: SystemServerStartRecord | null = null) {
  const savedRecords: SystemUpdateRecord[] = [];
  const logs = new Map<string, string>();
  return {
    savedRecords,
    logs,
    history: {
      recordServerStart: () => undefined,
      getUpdateLogPath: (startedAt: Date) => `/home/cloudcli/.cloudcli/logs/update-${startedAt.getTime()}.log`,
      writeUpdateLog: (logPath: string, contents: string) => {
        logs.set(logPath, contents);
      },
      // Copies, because the service finishes the same record object it first saved.
      recordUpdate: (record: SystemUpdateRecord) => {
        savedRecords.push({ ...record });
      },
      readHistory: () => ({
        lastStart,
        lastUpdate: null,
        lastStartPath: '/home/cloudcli/.cloudcli/last-start.json',
        lastUpdatePath: '/home/cloudcli/.cloudcli/last-update.json',
      }),
    },
  };
}

function createDependencies(
  overrides: Partial<SystemUpdateDependencies> = {},
): SystemUpdateDependencies {
  return {
    appRoot: '/app/cloudcli',
    homeDirectory: '/home/cloudcli',
    installMode: 'git',
    isPlatform: false,
    runningVersion: '1.37.4',
    nodeVersion: 'v24.21.0',
    environment: { TEST_ENVIRONMENT: 'true' },
    updateHistory: createUpdateHistory().history,
    runShellCommand: async () => ({ exitCode: 0, output: 'updated', errorOutput: '' }),
    readInstalledVersion: () => '1.37.4',
    checkInstalledPackage: async () => ({ passed: true }),
    now: () => new Date('2026-10-15T10:00:00.000Z'),
    logInfo: () => undefined,
    logError: () => undefined,
    ...overrides,
  };
}

// A global npm install that moves 1.37.4 to 1.37.5 on disk once its command ran.
function createNpmUpgrade(overrides: Partial<SystemUpdateDependencies> = {}) {
  let commandHasRun = false;
  const runShellCommand: SystemUpdateDependencies['runShellCommand'] = overrides.runShellCommand
    ?? (async () => ({ exitCode: 0, output: 'changed 949 packages in 2m\n', errorOutput: '' }));
  return createDependencies({
    installMode: 'npm',
    readInstalledVersion: () => (commandHasRun ? '1.37.5' : '1.37.4'),
    ...overrides,
    runShellCommand: async (...commandArguments) => {
      commandHasRun = true;
      return runShellCommand(...commandArguments);
    },
  });
}

const UPDATE_DETAILS_WITHOUT_ROLLBACK = {
  previousVersion: '1.37.4',
  installedVersion: '1.37.4',
  rollbackCommand: null,
  logPath: '/home/cloudcli/.cloudcli/logs/update-1792058400000.log',
};

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
    ...UPDATE_DETAILS_WITHOUT_ROLLBACK,
  });
});

test('global npm installations update from the user home directory', async () => {
  const calls: unknown[][] = [];
  const dependencies = createDependencies({
    installMode: 'npm',
    runShellCommand: async (command, workingDirectory, environment) => {
      calls.push([command, workingDirectory, environment]);
      return { exitCode: 0, output: '', errorOutput: '' };
    },
  });
  const service = createSystemUpdateService(dependencies);

  const result = await service.updateSystem();

  assert.deepEqual(calls, [[
    'npm install -g @cloudcli-ai/cloudcli@latest',
    '/home/cloudcli',
    dependencies.environment,
  ]]);
  assert.ok(result.success);
  assert.equal(result.output, 'Update completed successfully');
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
    ...UPDATE_DETAILS_WITHOUT_ROLLBACK,
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
    ...UPDATE_DETAILS_WITHOUT_ROLLBACK,
  });
});

test('npm warnings on stderr are logged as output, not as update errors', async () => {
  const errorLogs: string[] = [];
  const infoLogs: string[] = [];
  const service = createSystemUpdateService(createDependencies({
    installMode: 'npm',
    runShellCommand: async (_command, _workingDirectory, _environment, onOutput, onErrorOutput) => {
      onErrorOutput('npm warn deprecated inflight@1.0.6: This module is not supported\n');
      onOutput('added 1 package, and changed 949 packages in 2m\n');
      return { exitCode: 0, output: 'added 1 package', errorOutput: 'npm warn deprecated inflight@1.0.6' };
    },
    logInfo: (message, detail) => infoLogs.push(`${message} ${detail ?? ''}`),
    logError: (message, detail) => errorLogs.push(`${message} ${detail ?? ''}`),
  }));

  const result = await service.updateSystem();

  assert.equal(result.success, true);
  assert.deepEqual(errorLogs, []);
  assert.ok(infoLogs.some((line) => line.includes('npm warn deprecated inflight@1.0.6')));
});

test('an npm install that cannot load fails the update and names the version to go back to', async () => {
  let checkedPackages = 0;
  const service = createSystemUpdateService(createNpmUpgrade({
    checkInstalledPackage: async () => {
      checkedPackages += 1;
      return {
        passed: false,
        reason: 'better-sqlite3: Could not locate the bindings file.',
        details: 'better-sqlite3: Could not locate the bindings file. Tried:\n → /app/build/better_sqlite3.node',
      };
    },
  }));

  const result = await service.updateSystem();

  assert.equal(checkedPackages, 1);
  assert.equal(result.success, false);
  assert.equal(result.previousVersion, '1.37.4');
  assert.equal(result.installedVersion, '1.37.5');
  assert.equal(result.rollbackCommand, 'npm install -g @cloudcli-ai/cloudcli@1.37.4');
  assert.ok('error' in result);
  assert.equal(
    result.error,
    '1.37.5 was installed but cannot start: better-sqlite3: Could not locate the bindings file.'
      + ' This server keeps running 1.37.4 until it restarts.'
      + ' To go back, run "npm install -g @cloudcli-ai/cloudcli@1.37.4".'
      + ' Full log: /home/cloudcli/.cloudcli/logs/update-1792058400000.log',
  );
});

test('the version to go back to is the running one, even when a newer install is already on disk', async () => {
  const service = createSystemUpdateService(createNpmUpgrade({
    runningVersion: '1.37.3',
    checkInstalledPackage: async () => ({ passed: false, reason: 'node-pty: invalid ELF header', details: '' }),
  }));

  const result = await service.updateSystem();

  assert.equal(result.previousVersion, '1.37.4');
  assert.equal(result.rollbackCommand, 'npm install -g @cloudcli-ai/cloudcli@1.37.3');
});

test('every update leaves a log and a record of the invocation, versions and outcome', async () => {
  const { history, savedRecords, logs } = createUpdateHistory();
  const service = createSystemUpdateService(createNpmUpgrade({
    updateHistory: history,
    runShellCommand: async () => ({
      exitCode: 0,
      output: 'added 1 package, and changed 949 packages in 2m\n',
      errorOutput: 'npm warn deprecated inflight@1.0.6: This module is not supported\n',
    }),
  }));

  const result = await service.updateSystem();

  const logPath = '/home/cloudcli/.cloudcli/logs/update-1792058400000.log';
  assert.equal(result.success, true);
  assert.equal(result.logPath, logPath);
  assert.deepEqual(savedRecords.at(-1), {
    source: 'web',
    installMode: 'npm',
    command: 'npm install -g @cloudcli-ai/cloudcli@latest',
    workingDirectory: '/home/cloudcli',
    appRoot: '/app/cloudcli',
    nodeVersion: 'v24.21.0',
    runningVersion: '1.37.4',
    previousVersion: '1.37.4',
    installedVersion: '1.37.5',
    startedAt: '2026-10-15T10:00:00.000Z',
    finishedAt: '2026-10-15T10:00:00.000Z',
    exitCode: 0,
    result: 'succeeded',
    failureReason: null,
    rollbackCommand: 'npm install -g @cloudcli-ai/cloudcli@1.37.4',
    logPath,
  });
  const log = logs.get(logPath) ?? '';
  assert.match(log, /^Command: +npm install -g @cloudcli-ai\/cloudcli@latest$/m);
  assert.match(log, /^Working directory: +\/home\/cloudcli$/m);
  assert.match(log, /^Previous version: +1\.37\.4$/m);
  assert.match(log, /^Installed version: +1\.37\.5$/m);
  assert.match(log, /^Exit code: +0$/m);
  assert.match(log, /===== stdout =====\nadded 1 package, and changed 949 packages in 2m\n/);
  assert.match(log, /===== stderr \(warnings and errors\) =====\nnpm warn deprecated inflight/);
});

test('the update record is saved before the command runs, so an interrupted update is visible', async () => {
  const { history, savedRecords } = createUpdateHistory();
  let recordsSavedBeforeCommand: SystemUpdateRecord[] = [];
  const service = createSystemUpdateService(createDependencies({
    updateHistory: history,
    runShellCommand: async () => {
      recordsSavedBeforeCommand = [...savedRecords];
      return { exitCode: 0, output: '', errorOutput: '' };
    },
  }));

  await service.updateSystem();

  assert.equal(recordsSavedBeforeCommand.length, 1);
  assert.equal(recordsSavedBeforeCommand[0].result, 'running');
  assert.equal(recordsSavedBeforeCommand[0].finishedAt, null);
  assert.equal(recordsSavedBeforeCommand[0].logPath, null);
  assert.equal(savedRecords.at(-1)?.logPath, '/home/cloudcli/.cloudcli/logs/update-1792058400000.log');
});

test('an update command ended by a signal is recorded as stopped, not as exit code null', async () => {
  const { history, savedRecords } = createUpdateHistory();
  const service = createSystemUpdateService(createNpmUpgrade({
    updateHistory: history,
    // What the adapter resolves when npm is killed (an OOM kill, a platform restart).
    runShellCommand: async () => ({ exitCode: null, output: 'reify: timing', errorOutput: '' }),
  }));

  const result = await service.updateSystem();

  assert.equal(result.success, false);
  assert.equal(savedRecords.at(-1)?.result, 'failed');
  assert.equal(savedRecords.at(-1)?.exitCode, null);
  assert.equal(savedRecords.at(-1)?.failureReason, 'Update command was stopped by a signal before it finished');
});

test('a history folder that cannot be written never fails a finished update', async () => {
  const errorLogs: string[] = [];
  const { history } = createUpdateHistory();
  const service = createSystemUpdateService(createNpmUpgrade({
    updateHistory: {
      ...history,
      writeUpdateLog: () => {
        throw new Error('EACCES: permission denied');
      },
      recordUpdate: () => {
        throw new Error('EACCES: permission denied');
      },
    },
    logError: (message, detail) => errorLogs.push(`${message} ${detail ?? ''}`),
  }));

  const result = await service.updateSystem();

  assert.equal(result.success, true);
  assert.equal(result.logPath, null);
  assert.ok(errorLogs.every((line) => line.includes('EACCES')));
});

test('git, platform and failed npm updates are recorded but not package-checked', async () => {
  for (const overrides of [
    { installMode: 'git' as const },
    { installMode: 'npm' as const, isPlatform: true },
    {
      installMode: 'npm' as const,
      runShellCommand: async () => ({ exitCode: 1, output: '', errorOutput: 'npm error code E404' }),
    },
  ]) {
    let checkedPackages = 0;
    const { history, savedRecords } = createUpdateHistory();
    const service = createSystemUpdateService(createDependencies({
      ...overrides,
      updateHistory: history,
      checkInstalledPackage: async () => {
        checkedPackages += 1;
        return { passed: true };
      },
    }));

    await service.updateSystem();

    assert.equal(checkedPackages, 0);
    assert.equal(savedRecords.length, 2);
    assert.notEqual(savedRecords.at(-1)?.result, 'running');
  }
});

test('cloudcli update runs through the same recorded workflow with its own command', async () => {
  const calls: unknown[][] = [];
  const outputChunks: string[] = [];
  const { history, savedRecords } = createUpdateHistory();
  const runRecordedUpdate = createRecordedUpdateRunner(createNpmUpgrade({
    runningVersion: null,
    updateHistory: history,
    runShellCommand: async (command, workingDirectory, _environment, onOutput) => {
      calls.push([command, workingDirectory]);
      onOutput('changed 949 packages\n');
      return { exitCode: 0, output: 'changed 949 packages\n', errorOutput: '' };
    },
    checkInstalledPackage: async () => ({ passed: false, reason: 'node-pty: invalid ELF header', details: '' }),
  }));

  const { record } = await runRecordedUpdate({
    source: 'cli',
    command: 'npm update -g @cloudcli-ai/cloudcli',
    workingDirectory: '/home/cloudcli',
    onOutput: (output) => outputChunks.push(output),
    onErrorOutput: () => undefined,
  });

  assert.deepEqual(calls, [['npm update -g @cloudcli-ai/cloudcli', '/home/cloudcli']]);
  assert.deepEqual(outputChunks, ['changed 949 packages\n']);
  assert.equal(record.source, 'cli');
  assert.equal(record.result, 'verification-failed');
  assert.equal(record.rollbackCommand, 'npm install -g @cloudcli-ai/cloudcli@1.37.4');
  assert.deepEqual(savedRecords.at(-1), record);
});

test('cloudcli update goes back to the last version this install started, not an unstarted one', async () => {
  const lastStart: SystemServerStartRecord = {
    version: '1.37.3',
    appRoot: '/app/cloudcli',
    installMode: 'npm',
    nodeVersion: 'v24.21.0',
    startedAt: '2026-10-14T10:00:00.000Z',
  };
  const startedElsewhere: SystemServerStartRecord = {
    ...lastStart,
    version: '1.36.0',
    appRoot: '/home/cloudcli/src/claudecodeui',
  };
  const rollbackCommands: Array<string | null> = [];
  for (const startRecord of [lastStart, startedElsewhere]) {
    const runRecordedUpdate = createRecordedUpdateRunner(createNpmUpgrade({
      runningVersion: null,
      updateHistory: createUpdateHistory(startRecord).history,
      checkInstalledPackage: async () => ({ passed: false, reason: 'node-pty: invalid ELF header', details: '' }),
    }));

    const { record } = await runRecordedUpdate({
      source: 'cli',
      command: 'npm update -g @cloudcli-ai/cloudcli',
      workingDirectory: '/home/cloudcli',
      onOutput: () => undefined,
      onErrorOutput: () => undefined,
    });
    rollbackCommands.push(record.rollbackCommand);
  }

  // A start recorded by another install (a dev checkout sharing the home folder) does not count.
  assert.deepEqual(rollbackCommands, [
    'npm install -g @cloudcli-ai/cloudcli@1.37.3',
    'npm install -g @cloudcli-ai/cloudcli@1.37.4',
  ]);
});
