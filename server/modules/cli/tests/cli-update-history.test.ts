import assert from 'node:assert/strict';
import test from 'node:test';

import type { CliOutput, SystemUpdateHistory, SystemUpdateRecord } from '@/shared/types.js';
import { stripAnsiSequences } from '@/shared/utils.js';

import { createCliService } from '../cli.service.js';

const EMPTY_UPDATE_HISTORY: SystemUpdateHistory = {
  lastStart: null,
  lastUpdate: null,
  lastStartPath: '/home/user/.cloudcli/last-start.json',
  lastUpdatePath: '/home/user/.cloudcli/last-update.json',
};

const UPDATE_RECORD: SystemUpdateRecord = {
  source: 'cli',
  installMode: 'npm',
  command: 'npm update -g @cloudcli-ai/cloudcli',
  workingDirectory: '/home/user',
  appRoot: '/application',
  nodeVersion: 'v24.21.0',
  runningVersion: null,
  previousVersion: '1.2.3',
  installedVersion: '1.2.4',
  startedAt: '2026-10-15T10:00:00.000Z',
  finishedAt: '2026-10-15T10:02:00.000Z',
  exitCode: 0,
  result: 'succeeded',
  failureReason: null,
  rollbackCommand: 'npm install -g @cloudcli-ai/cloudcli@1.2.3',
  logPath: '/home/user/.cloudcli/logs/update-2026-10-15T10-00-00-000Z.log',
};

type HarnessOptions = {
  latestVersion?: string;
  updateRecord?: SystemUpdateRecord;
  updateHistory?: SystemUpdateHistory | Error;
};

// `cloudcli update` and `cloudcli status` against canned update records; the
// system module tests cover how those records are produced.
function createHarness(options: HarnessOptions = {}) {
  const logMessages: string[] = [];
  const errorMessages: string[] = [];
  const output: CliOutput = {
    log: (message = '') => logMessages.push(message),
    error: (message = '') => errorMessages.push(message),
  };
  let packageUpdates = 0;
  const service = createCliService({
    applicationRoot: '/application',
    defaultDatabasePath: '/home/user/.cloudcli/auth.db',
    homeDirectory: '/home/user',
    packageMetadata: {
      version: '1.2.3',
      homepage: 'https://cloudcli.example',
      bugsUrl: 'https://cloudcli.example/issues',
    },
    environment: {},
    fileSystem: {
      pathExists: () => false,
      getFileStats: () => ({ size: 0, modifiedAt: new Date(0) }),
    },
    output,
    sandboxService: { execute: async () => 0 },
    getLatestPackageVersion: async () => options.latestVersion ?? '1.2.3',
    updateGlobalPackage: async () => {
      packageUpdates += 1;
      return options.updateRecord ?? UPDATE_RECORD;
    },
    readUpdateHistory: async () => {
      if (options.updateHistory instanceof Error) {
        throw options.updateHistory;
      }
      return options.updateHistory ?? EMPTY_UPDATE_HISTORY;
    },
    startServer: async () => undefined,
    startBrowserUseMcp: async () => undefined,
  });

  return {
    service,
    logMessages,
    errorMessages,
    getPackageUpdates: () => packageUpdates,
  };
}

test('update reports the version change and where the update log is', async () => {
  const harness = createHarness({ latestVersion: '1.2.4' });

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 0);
  assert.equal(harness.getPackageUpdates(), 1);
  assert.ok(harness.logMessages.some((line) => line.includes('Update complete (1.2.3 -> 1.2.4)')));
  assert.ok(harness.logMessages.some((line) => line.includes(
    'If it does not start after the restart, go back with: npm install -g @cloudcli-ai/cloudcli@1.2.3',
  )));
  assert.ok(harness.logMessages.some((line) => line.includes(
    'Update log: /home/user/.cloudcli/logs/update-2026-10-15T10-00-00-000Z.log',
  )));
});

test('update fails with the rollback command when the installed version cannot start', async () => {
  const harness = createHarness({
    latestVersion: '1.2.4',
    updateRecord: {
      ...UPDATE_RECORD,
      result: 'verification-failed',
      failureReason: 'better-sqlite3: Could not locate the bindings file.',
    },
  });

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 1);
  assert.ok(harness.errorMessages.some((line) => line.includes(
    '1.2.4 was installed but cannot start: better-sqlite3: Could not locate the bindings file.',
  )));
  assert.ok(harness.logMessages.some((line) => line.includes(
    'Go back with: npm install -g @cloudcli-ai/cloudcli@1.2.3',
  )));
  assert.ok(!harness.logMessages.some((line) => line.includes('Update complete')));
});

test('update exits non-zero when the npm command fails', async () => {
  const harness = createHarness({
    latestVersion: '1.2.4',
    updateRecord: {
      ...UPDATE_RECORD,
      installedVersion: '1.2.3',
      exitCode: 1,
      result: 'failed',
      failureReason: 'Update command exited with code 1',
    },
  });

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 1);
  assert.ok(harness.errorMessages.some((line) => line.includes('Update failed: Update command exited with code 1')));
});

test('status names the last version that started and the last update, with the way back', async () => {
  const harness = createHarness({
    updateHistory: {
      ...EMPTY_UPDATE_HISTORY,
      lastStart: {
        version: '1.2.2',
        appRoot: '/application',
        installMode: 'npm',
        nodeVersion: 'v24.21.0',
        startedAt: '2026-10-15T09:00:00.000Z',
      },
      lastUpdate: {
        ...UPDATE_RECORD,
        source: 'web',
        previousVersion: '1.2.2',
        installedVersion: '1.2.3',
        runningVersion: '1.2.2',
        result: 'verification-failed',
        failureReason: 'node-pty: invalid ELF header',
        rollbackCommand: 'npm install -g @cloudcli-ai/cloudcli@1.2.2',
      },
    },
  });

  const exitCode = await harness.service.run(['status']);

  const statusText = stripAnsiSequences(harness.logMessages.join('\n'));
  assert.equal(exitCode, 0);
  assert.match(statusText, /Version: 1\.2\.3/);
  assert.match(statusText, /Last started: 1\.2\.2 at /);
  assert.match(statusText, /1\.2\.3 is installed but has not started yet/);
  assert.match(statusText, /Last update: +1\.2\.2 -> 1\.2\.3 from web, installed, but cannot start/);
  assert.match(statusText, /node-pty: invalid ELF header/);
  assert.match(statusText, /Update log: +\/home\/user\/\.cloudcli\/logs\/update-2026-10-15T10-00-00-000Z\.log/);
  assert.match(statusText, /Roll back: +npm install -g @cloudcli-ai\/cloudcli@1\.2\.2/);
});

test('status derives the way back from the last start when npm replaced the install by hand', async () => {
  const harness = createHarness({
    updateHistory: {
      ...EMPTY_UPDATE_HISTORY,
      lastStart: {
        version: '1.2.2',
        appRoot: '/application',
        installMode: 'npm',
        nodeVersion: 'v24.21.0',
        startedAt: '2026-10-15T09:00:00.000Z',
      },
    },
  });

  await harness.service.run(['status']);

  const statusText = stripAnsiSequences(harness.logMessages.join('\n'));
  assert.match(statusText, /Last update: +not recorded yet \(\/home\/user\/\.cloudcli\/last-update\.json\)/);
  assert.match(statusText, /Roll back: +npm install -g @cloudcli-ai\/cloudcli@1\.2\.2/);
});

test('status says where it looked when nothing has been recorded yet', async () => {
  const harness = createHarness();

  await harness.service.run(['status']);

  const statusText = stripAnsiSequences(harness.logMessages.join('\n'));
  assert.match(statusText, /Last started: not recorded yet \(\/home\/user\/\.cloudcli\/last-start\.json\)/);
  assert.doesNotMatch(statusText, /Roll back:/);
  assert.doesNotMatch(statusText, /has not started yet/);
});

test('status stops offering a way back once the installed version has started', async () => {
  const harness = createHarness({
    updateHistory: {
      ...EMPTY_UPDATE_HISTORY,
      lastStart: {
        version: '1.2.3',
        appRoot: '/application',
        installMode: 'npm',
        nodeVersion: 'v24.21.0',
        startedAt: '2026-10-15T11:00:00.000Z',
      },
      lastUpdate: { ...UPDATE_RECORD, result: 'verification-failed', failureReason: 'node-pty: invalid ELF header' },
    },
  });

  await harness.service.run(['status']);

  const statusText = stripAnsiSequences(harness.logMessages.join('\n'));
  assert.match(statusText, /Last started: 1\.2\.3 at /);
  assert.doesNotMatch(statusText, /has not started yet/);
  assert.doesNotMatch(statusText, /Roll back:/);
});

test('status falls back to the failed update record when no start was recorded for this install', async () => {
  const harness = createHarness({
    updateHistory: {
      ...EMPTY_UPDATE_HISTORY,
      lastStart: {
        version: '1.2.0',
        appRoot: '/home/user/src/claudecodeui',
        installMode: 'git',
        nodeVersion: 'v24.21.0',
        startedAt: '2026-10-14T11:00:00.000Z',
      },
      lastUpdate: { ...UPDATE_RECORD, result: 'running', finishedAt: null },
    },
  });

  await harness.service.run(['status']);

  const statusText = stripAnsiSequences(harness.logMessages.join('\n'));
  assert.match(statusText, /Last started: 1\.2\.0 at .* \(from \/home\/user\/src\/claudecodeui\)/);
  assert.match(statusText, /Last update: +1\.2\.3 -> 1\.2\.4 from cli, did not finish/);
  assert.match(statusText, /Roll back: +npm install -g @cloudcli-ai\/cloudcli@1\.2\.3/);
});

test('status still prints the rest when the update history cannot be loaded', async () => {
  const harness = createHarness({ updateHistory: new Error("Cannot find package 'express'") });

  const exitCode = await harness.service.run(['status']);

  const statusText = stripAnsiSequences(harness.logMessages.join('\n'));
  assert.equal(exitCode, 0);
  assert.match(statusText, /Could not read the update history: Cannot find package 'express'/);
  assert.match(statusText, /Database Location:/);
});
