import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createAntigravityCliLivenessService } from '@/modules/providers/services/antigravity-cli-liveness.service.js';
import { getLinuxFileLockIdentity } from '@/shared/index.js';

const linuxTest = process.platform === 'linux' ? test : test.skip;

const ID = 'b6071a8b-c438-41dc-bc18-3a5447df6110';
const PID = 12345;

async function fixture(run: (context: {
  directory: string;
  procRoot: string;
  dataDirectory: string;
  database: Database.Database;
  lockLine: string;
  service: ReturnType<typeof createAntigravityCliLivenessService>;
}) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'antigravity-liveness-'));
  const procRoot = path.join(directory, 'proc');
  const dataDirectory = path.join(directory, 'antigravity-cli');
  await mkdir(path.join(procRoot, String(PID)), { recursive: true });
  await mkdir(path.join(dataDirectory, 'presence'), { recursive: true });
  const database = new Database(path.join(dataDirectory, 'conversation_summaries.db'));
  try {
    database.exec(`CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY, status TEXT, not_fully_idle INTEGER,
      killed INTEGER, last_user_input_time TEXT
    )`);
    database.prepare('INSERT INTO conversation_summaries VALUES (?, ?, 1, 0, ?)')
      .run(ID, 'CASCADE_RUN_STATUS_RUNNING', '2026-10-22 11:36:59.51489912+00:00');
    const lockPath = path.join(dataDirectory, 'presence', `${ID}.lock`);
    await writeFile(lockPath, '');
    const lockStat = await stat(lockPath, { bigint: true });
    const lockLine = `1: FLOCK ADVISORY WRITE ${PID} ${getLinuxFileLockIdentity(lockStat.dev, lockStat.ino)} 0 EOF\n`;
    await writeFile(path.join(procRoot, 'locks'), lockLine);
    await symlink('/opt/antigravity/agy', path.join(procRoot, String(PID), 'exe'));
    await writeFile(path.join(procRoot, String(PID), 'stat'), `${PID} (agy worker)) S 0 0\n`);
    const service = createAntigravityCliLivenessService({ procRoot, getDataDirectory: () => dataDirectory });
    await run({ directory, procRoot, dataDirectory, database, lockLine, service });
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

linuxTest('running native AGY conversation is reported only with its live presence lock', async () => {
  await fixture(async ({ service }) => {
    assert.deepEqual(await service.listSessions(), [{
      providerSessionId: ID, startedAt: Date.parse('2026-10-22T11:36:59.514Z'), canInterrupt: false,
    }]);
    assert.equal((await service.getSession(ID))?.providerSessionId, ID);
    assert.equal(await service.getSession('../outside'), null);
  });
});

linuxTest('idle and killed conversations are excluded while background work remains visible', async () => {
  await fixture(async ({ database, service }) => {
    database.exec("UPDATE conversation_summaries SET status = 'CASCADE_RUN_STATUS_IDLE', not_fully_idle = 0");
    assert.deepEqual(await service.listSessions(), []);
    database.exec('UPDATE conversation_summaries SET not_fully_idle = 1');
    assert.equal((await service.listSessions()).length, 1);
    database.exec('UPDATE conversation_summaries SET killed = 1');
    assert.deepEqual(await service.listSessions(), []);
    for (const status of ['CASCADE_RUN_STATUS_BUSY', 'CASCADE_RUN_STATUS_CANCELING']) {
      database.prepare('UPDATE conversation_summaries SET status = ?, not_fully_idle = 0, killed = 0').run(status);
      assert.equal((await service.listSessions()).length, 1);
    }
  });
});

linuxTest('stale, queued, shared and SQLite locks cannot make a crashed conversation appear active', async () => {
  await fixture(async ({ procRoot, lockLine, service }) => {
    for (const contents of ['', lockLine.replace('FLOCK', 'POSIX'), lockLine.replace('WRITE', 'READ'), lockLine.replace('FLOCK', '-> FLOCK')]) {
      await writeFile(path.join(procRoot, 'locks'), contents);
      assert.deepEqual(await service.listSessions(), []);
    }
  });
});

linuxTest('PID reuse, a different executable and zombie owners are excluded', async () => {
  await fixture(async ({ procRoot, service }) => {
    const executable = path.join(procRoot, String(PID), 'exe');
    await unlink(executable);
    await symlink('/opt/other/node', executable);
    assert.deepEqual(await service.listSessions(), []);
    await unlink(executable);
    await symlink('/opt/antigravity/agy', executable);
    await writeFile(path.join(procRoot, String(PID), 'stat'), `${PID} (agy) Z 0 0\n`);
    assert.deepEqual(await service.listSessions(), []);
    await rm(path.join(procRoot, String(PID)), { recursive: true });
    assert.deepEqual(await service.listSessions(), []);
  });
});

linuxTest('missing stores and older schemas are optional and never create a native database', async () => {
  await fixture(async ({ directory, dataDirectory, database, service }) => {
    const missing = path.join(directory, 'missing');
    assert.deepEqual(await createAntigravityCliLivenessService({ getDataDirectory: () => missing }).listSessions(), []);
    await assert.rejects(stat(missing), { code: 'ENOENT' });
    // A writer may disappear between the SQLite snapshot and the presence check.
    await unlink(path.join(dataDirectory, 'presence', `${ID}.lock`));
    assert.deepEqual(await service.listSessions(), []);
    database.exec('DROP TABLE conversation_summaries');
    assert.deepEqual(await service.listSessions(), []);
  });
});


linuxTest('a new summary with a zero or invalid input time uses its presence timestamp', async () => {
  await fixture(async ({ database, service }) => {
    for (const value of ['0001-01-01 00:00:00+00:00', '']) {
      database.prepare('UPDATE conversation_summaries SET last_user_input_time = ?').run(value);
      const [live] = await service.listSessions();
      assert.ok(live.startedAt > Date.now() - 60_000);
      assert.ok(live.startedAt <= Date.now());
    }
  });
});
