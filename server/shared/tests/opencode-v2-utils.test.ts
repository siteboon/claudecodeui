import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import Database from 'better-sqlite3';

import { readOpenCodeCliMajorVersion, readOpenCodeLiveSessionTable, readOpenCodeSessionTables } from '@/shared/utils.js';

/** An opencode.db with these session tables, each row as `[id, time_updated]` (null: only `time_created`, 5). */
const createDatabase = (tables: Record<string, Array<[string, number | null]>>) => {
  const db = new Database(':memory:');
  for (const [table, rows] of Object.entries(tables)) {
    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, time_created INTEGER NOT NULL, time_updated INTEGER)`);
    for (const [id, timeUpdated] of rows) {
      db.prepare(`INSERT INTO ${table} (id, time_created, time_updated) VALUES (?, 5, ?)`).run(id, timeUpdated);
    }
  }
  return db;
};

test('the OpenCode session tables, and the one that holds the live copy of each session', () => {
  const read = (tables: Record<string, Array<[string, number | null]>>, sessionId: string) => {
    const db = createDatabase(tables);
    try {
      return { tables: readOpenCodeSessionTables(db), live: readOpenCodeLiveSessionTable(db, sessionId) };
    } finally {
      db.close();
    }
  };

  // One layout: that table, whether or not it has the session.
  assert.deepEqual(read({ session: [['ses_a', 2]] }, 'ses_other'), { tables: ['session'], live: 'session' });
  assert.deepEqual(read({ session_v2: [['ses_a', 2]] }, 'ses_other'), { tables: ['session_v2'], live: 'session_v2' });
  assert.deepEqual(read({}, 'ses_a'), { tables: [], live: null });

  // Both layouts: the copy updated last, 2.x on a tie (2.x copies a session as it migrates it).
  const cases: Array<[Record<string, Array<[string, number | null]>>, string]> = [
    [{ session: [['ses_a', 2]], session_v2: [] }, 'session'],
    [{ session: [], session_v2: [['ses_a', 2]] }, 'session_v2'],
    [{ session: [['ses_a', 2]], session_v2: [['ses_a', 2]] }, 'session_v2'],
    // Continued by a 1.x CLI after the migration.
    [{ session: [['ses_a', 4]], session_v2: [['ses_a', 2]] }, 'session'],
    // Continued by 2.x.
    [{ session: [['ses_a', 2]], session_v2: [['ses_a', 4]] }, 'session_v2'],
    // Another session written later does not matter.
    [{ session: [['ses_a', 2], ['ses_b', 9]], session_v2: [['ses_a', 2]] }, 'session_v2'],
    [{ session: [['ses_a', 4]], session_v2: [['ses_a', 2], ['ses_b', 9]] }, 'session'],
    // Without time_updated, time_created counts.
    [{ session: [['ses_a', null]], session_v2: [['ses_a', 3]] }, 'session'],
    [{ session: [['ses_b', 2]], session_v2: [['ses_b', 2]] }, 'session_v2'],
  ];
  for (const [tables, expected] of cases) {
    assert.deepEqual(read(tables, 'ses_a'), { tables: ['session', 'session_v2'], live: expected }, JSON.stringify(tables));
  }
});

test('the major version of the OpenCode CLI on PATH is read once per executable and again when it changes', { skip: process.platform === 'win32' }, async () => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-version-'));
  const executable = path.join(binDir, 'opencode');
  const probeLog = path.join(binDir, 'probes.log');
  await writeFile(executable, [
    '#!/bin/sh',
    `echo "$1" >> "${probeLog}"`,
    'printf "%s\\n" "$FAKE_OPENCODE_VERSION_OUTPUT"',
    'exit "${FAKE_OPENCODE_VERSION_EXIT:-0}"',
    '',
  ].join('\n'));
  await chmod(executable, 0o755);

  const savedPath = process.env.PATH;
  let stamp = Date.now();
  const install = (output: string, exitCode = 0) => {
    process.env.FAKE_OPENCODE_VERSION_OUTPUT = output;
    process.env.FAKE_OPENCODE_VERSION_EXIT = String(exitCode);
    stamp += 10_000;
    fs.utimesSync(executable, new Date(stamp), new Date(stamp));
  };
  const probes = async () => (await readFile(probeLog, 'utf8').catch(() => '')).split('\n').filter(Boolean);

  process.env.PATH = binDir;
  try {
    install('opencode v2.2.3');
    assert.equal(await readOpenCodeCliMajorVersion(), 2);
    // Cached, and concurrent readers share one run.
    assert.deepEqual(await Promise.all([readOpenCodeCliMajorVersion(), readOpenCodeCliMajorVersion()]), [2, 2]);
    assert.deepEqual(await probes(), ['--version']);

    install('1.18.25');
    assert.equal(await readOpenCodeCliMajorVersion(), 1);
    install('0.0.0-dev-202610300000');
    assert.equal(await readOpenCodeCliMajorVersion(), 0);
    install('no version here');
    assert.equal(await readOpenCodeCliMajorVersion(), null);
    install('opencode v2.2.3', 1);
    assert.equal(await readOpenCodeCliMajorVersion(), null);
    assert.equal((await probes()).length, 5);

    process.env.PATH = path.join(binDir, 'missing');
    assert.equal(await readOpenCodeCliMajorVersion(), null);
  } finally {
    process.env.PATH = savedPath;
    delete process.env.FAKE_OPENCODE_VERSION_OUTPUT;
    delete process.env.FAKE_OPENCODE_VERSION_EXIT;
    await rm(binDir, { recursive: true, force: true });
  }
});

/**
 * A fake `opencode` alone on PATH: `--version` prints FAKE_OPENCODE_VERSION_OUTPUT,
 * exits with FAKE_OPENCODE_VERSION_EXIT and logs each run. Each test gets its own
 * executable, so the version cache never answers for another test's file.
 */
async function withFakeOpenCode(runTest: (fake: {
  executable: string;
  answer: (output: string, exitCode?: number) => void;
  touch: () => void;
  probes: () => Promise<number>;
}) => Promise<void>) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-version-'));
  const executable = path.join(binDir, 'opencode');
  const probeLog = path.join(binDir, 'probes.log');
  await writeFile(executable, [
    '#!/bin/sh',
    `echo "$1" >> "${probeLog}"`,
    'printf "%s\\n" "$FAKE_OPENCODE_VERSION_OUTPUT"',
    'exit "${FAKE_OPENCODE_VERSION_EXIT:-0}"',
    '',
  ].join('\n'));
  await chmod(executable, 0o755);
  let stamp = Date.now();
  const savedPath = process.env.PATH;
  process.env.PATH = binDir;
  try {
    await runTest({
      executable,
      answer: (output, exitCode = 0) => {
        process.env.FAKE_OPENCODE_VERSION_OUTPUT = output;
        process.env.FAKE_OPENCODE_VERSION_EXIT = String(exitCode);
      },
      // An upgrade replaces the file.
      touch: () => {
        stamp += 10_000;
        fs.utimesSync(executable, new Date(stamp), new Date(stamp));
      },
      probes: async () => (await readFile(probeLog, 'utf8').catch(() => '')).split('\n').filter(Boolean).length,
    });
  } finally {
    mock.timers.reset();
    process.env.PATH = savedPath;
    delete process.env.FAKE_OPENCODE_VERSION_OUTPUT;
    delete process.env.FAKE_OPENCODE_VERSION_EXIT;
    await rm(binDir, { recursive: true, force: true });
  }
}

test('`opencode --version` gets 20 s, and an executable that answered before keeps its answer while it times out', { skip: process.platform === 'win32' }, async () => {
  await withFakeOpenCode(async (fake) => {
    // The clock runs ahead of the answer: 6 s pass before it arrives.
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    fake.answer('opencode v2.2.3');
    const slow = readOpenCodeCliMajorVersion();
    mock.timers.tick(6_000);
    assert.equal(await slow, 2);

    // Replaced (an upgrade), and the new file gives no answer within 20 s:
    // still 2.x rather than the SDK path, and asked again after 30 s.
    fake.touch();
    const stuck = readOpenCodeCliMajorVersion();
    mock.timers.tick(20_000);
    assert.equal(await stuck, 2);
    // It would answer now, but is not asked before the retry.
    fake.answer('1.18.25');
    mock.timers.tick(29_000);
    assert.equal(await readOpenCodeCliMajorVersion(), 2);
    mock.timers.tick(2_000);
    assert.equal(await readOpenCodeCliMajorVersion(), 1);
  });

  // A file that never answered has no answer to keep.
  await withFakeOpenCode(async (fake) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    fake.answer('opencode v2.2.3');
    const stuck = readOpenCodeCliMajorVersion();
    mock.timers.tick(20_000);
    assert.equal(await stuck, null);
  });
});

test('a failed `opencode --version` is asked again after 30 s, not sooner, and keeps no older answer', { skip: process.platform === 'win32' }, async () => {
  await withFakeOpenCode(async (fake) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    fake.answer('opencode v2.2.3');
    assert.equal(await readOpenCodeCliMajorVersion(), 2);

    // An answer that is an error is not a slow answer: unknown.
    fake.touch();
    fake.answer('opencode v2.2.3', 1);
    assert.equal(await readOpenCodeCliMajorVersion(), null);
    fake.answer('opencode v2.2.3');
    mock.timers.tick(10_000);
    assert.equal(await readOpenCodeCliMajorVersion(), null);
    assert.equal(await fake.probes(), 2);
    mock.timers.tick(21_000);
    assert.equal(await readOpenCodeCliMajorVersion(), 2);
    assert.equal(await fake.probes(), 3);
  });
});

test('a replaced `opencode` is asked again even when it keeps the old mtime', { skip: process.platform === 'win32' }, async () => {
  await withFakeOpenCode(async (fake) => {
    // Whole seconds, which the changes below put back exactly.
    const mtimeSeconds = Math.floor(Date.now() / 1000) - 60;
    const keepMtime = async (change: () => Promise<void>) => {
      await change();
      fs.utimesSync(fake.executable, mtimeSeconds, mtimeSeconds);
      assert.equal(fs.statSync(fake.executable).mtimeMs, mtimeSeconds * 1000);
    };

    await keepMtime(async () => {});
    fake.answer('opencode v2.2.3');
    assert.equal(await readOpenCodeCliMajorVersion(), 2);

    // Rewritten in place with another size.
    fake.answer('1.18.25');
    await keepMtime(async () => writeFile(fake.executable, `${await readFile(fake.executable, 'utf8')}# 1.x\n`));
    assert.equal(await readOpenCodeCliMajorVersion(), 1);

    // Same size, another file moved over it.
    fake.answer('opencode v2.2.5');
    await keepMtime(async () => {
      const replacement = `${fake.executable}.new`;
      await writeFile(replacement, await readFile(fake.executable, 'utf8'));
      await chmod(replacement, 0o755);
      await rename(replacement, fake.executable);
    });
    assert.equal(await readOpenCodeCliMajorVersion(), 2);
    assert.equal(await fake.probes(), 3);
  });
});
