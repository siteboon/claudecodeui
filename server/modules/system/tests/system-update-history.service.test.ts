import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { SystemServerStartRecord, SystemUpdateRecord } from '@/shared/types.js';

import { createSystemUpdateHistoryService } from '../system-update-history.service.js';

const DATA_DIRECTORY = path.join('/home/cloudcli', '.cloudcli');

function createInMemoryHistory() {
  const files = new Map<string, string>();
  const service = createSystemUpdateHistoryService({
    dataDirectory: DATA_DIRECTORY,
    readTextFile: (filePath) => {
      const contents = files.get(filePath);
      if (contents === undefined) {
        throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' });
      }
      return contents;
    },
    writeTextFile: (filePath, contents) => {
      files.set(filePath, contents);
    },
  });
  return { files, service };
}

const START_RECORD: SystemServerStartRecord = {
  version: '1.37.4',
  appRoot: '/usr/lib/node_modules/@cloudcli-ai/cloudcli',
  installMode: 'npm',
  nodeVersion: 'v24.21.0',
  startedAt: '2026-10-15T09:00:00.000Z',
};

const UPDATE_RECORD: SystemUpdateRecord = {
  source: 'web',
  installMode: 'npm',
  command: 'npm install -g @cloudcli-ai/cloudcli@latest',
  workingDirectory: '/root',
  appRoot: '/usr/lib/node_modules/@cloudcli-ai/cloudcli',
  nodeVersion: 'v24.21.0',
  runningVersion: '1.37.4',
  previousVersion: '1.37.4',
  installedVersion: '1.37.5',
  startedAt: '2026-10-15T10:00:00.000Z',
  finishedAt: '2026-10-15T10:02:00.000Z',
  exitCode: 0,
  result: 'verification-failed',
  failureReason: 'better-sqlite3: Could not locate the bindings file. Tried:',
  rollbackCommand: 'npm install -g @cloudcli-ai/cloudcli@1.37.4',
  logPath: path.join(DATA_DIRECTORY, 'logs', 'update-2026-10-15T10-00-00-000Z.log'),
};

test('history reads as empty, with the files it looked at, before anything is recorded', () => {
  const { service } = createInMemoryHistory();

  assert.deepEqual(service.readHistory(), {
    lastStart: null,
    lastUpdate: null,
    lastStartPath: path.join(DATA_DIRECTORY, 'last-start.json'),
    lastUpdatePath: path.join(DATA_DIRECTORY, 'last-update.json'),
  });
});

test('start and update records live in the data folder and read back unchanged', () => {
  const { files, service } = createInMemoryHistory();

  service.recordServerStart(START_RECORD);
  service.recordUpdate(UPDATE_RECORD);

  assert.deepEqual([...files.keys()].sort(), [
    path.join(DATA_DIRECTORY, 'last-start.json'),
    path.join(DATA_DIRECTORY, 'last-update.json'),
  ]);
  const history = service.readHistory();
  assert.deepEqual(history.lastStart, START_RECORD);
  assert.deepEqual(history.lastUpdate, UPDATE_RECORD);
});

test('update logs get one portable file name per update under logs/', () => {
  const { files, service } = createInMemoryHistory();

  const logPath = service.getUpdateLogPath(new Date('2026-10-15T10:00:00.000Z'));
  service.writeUpdateLog(logPath, 'CloudCLI update log\n');

  assert.equal(logPath, path.join(DATA_DIRECTORY, 'logs', 'update-2026-10-15T10-00-00-000Z.log'));
  assert.equal(files.get(logPath), 'CloudCLI update log\n');
});

test('an unreadable record reads as not recorded instead of breaking cloudcli status', () => {
  const { files, service } = createInMemoryHistory();
  files.set(path.join(DATA_DIRECTORY, 'last-start.json'), '{ truncated');
  files.set(path.join(DATA_DIRECTORY, 'last-update.json'), '"just a string"');

  const history = service.readHistory();

  assert.equal(history.lastStart, null);
  assert.equal(history.lastUpdate, null);
});
