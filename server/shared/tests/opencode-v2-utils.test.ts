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

/** One turn of the event loop; setImmediate is never mocked here. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** `'pending'` while `promise` has not settled after one turn of the event loop, else its value. */
const settledValue = async <T>(promise: Promise<T>): Promise<T | 'pending'> =>
  Promise.race([promise, yieldToEventLoop().then(() => 'pending' as const)]);

/**
 * A fake `opencode` alone on PATH: `--version` prints FAKE_OPENCODE_VERSION_OUTPUT,
 * exits with FAKE_OPENCODE_VERSION_EXIT and logs each run; with
 * FAKE_OPENCODE_VERSION_HANG it never answers. Each test gets its own
 * executable, so the version cache never answers for another test's file.
 */
async function withFakeOpenCode(runTest: (fake: {
  executable: string;
  answer: (output: string, exitCode?: number) => void;
  hang: (hanging: boolean) => void;
  touch: () => void;
  probes: () => Promise<number>;
  /** Waits (real time) until `count` runs have started, then a little longer, and returns how many did. */
  waitForProbes: (count: number) => Promise<number>;
}) => Promise<void>) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-cli-version-'));
  const executable = path.join(binDir, 'opencode');
  const probeLog = path.join(binDir, 'probes.log');
  await writeFile(executable, [
    '#!/bin/sh',
    `echo "$1" >> "${probeLog}"`,
    // PATH holds this folder only, so `sleep` is named by its path.
    `[ -n "$FAKE_OPENCODE_VERSION_HANG" ] && exec ${fs.existsSync('/bin/sleep') ? '/bin/sleep' : '/usr/bin/sleep'} 30`,
    'printf "%s\\n" "$FAKE_OPENCODE_VERSION_OUTPUT"',
    'exit "${FAKE_OPENCODE_VERSION_EXIT:-0}"',
    '',
  ].join('\n'));
  await chmod(executable, 0o755);
  let stamp = Date.now();
  const probes = async () => (await readFile(probeLog, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
  const savedPath = process.env.PATH;
  process.env.PATH = binDir;
  try {
    await runTest({
      executable,
      answer: (output, exitCode = 0) => {
        process.env.FAKE_OPENCODE_VERSION_OUTPUT = output;
        process.env.FAKE_OPENCODE_VERSION_EXIT = String(exitCode);
      },
      hang: (hanging) => {
        if (hanging) {
          process.env.FAKE_OPENCODE_VERSION_HANG = '1';
        } else {
          delete process.env.FAKE_OPENCODE_VERSION_HANG;
        }
      },
      // An upgrade replaces the file.
      touch: () => {
        stamp += 10_000;
        fs.utimesSync(executable, new Date(stamp), new Date(stamp));
      },
      probes,
      waitForProbes: async (count) => {
        // setTimeout and Date may be mocked: yield with setImmediate, measure with performance.now.
        const startedAt = performance.now();
        while ((await probes()) < count && performance.now() - startedAt < 5_000) {
          await yieldToEventLoop();
        }
        const settledAt = performance.now();
        while (performance.now() - settledAt < 200) {
          await yieldToEventLoop();
        }
        return probes();
      },
    });
  } finally {
    mock.timers.reset();
    process.env.PATH = savedPath;
    delete process.env.FAKE_OPENCODE_VERSION_OUTPUT;
    delete process.env.FAKE_OPENCODE_VERSION_EXIT;
    delete process.env.FAKE_OPENCODE_VERSION_HANG;
    await rm(binDir, { recursive: true, force: true });
  }
}

test('a file that has not answered gets 20 s for `opencode --version`, and one more try when that runs out', { skip: process.platform === 'win32' }, async () => {
  await withFakeOpenCode(async (fake) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    fake.answer('opencode v2.2.3');
    fake.hang(true);
    const first = readOpenCodeCliMajorVersion();
    // Started, and hanging.
    assert.equal(await fake.waitForProbes(1), 1);
    mock.timers.tick(19_999);
    assert.equal(await settledValue(first), 'pending');
    // Out of time once: asked again, and this time it answers.
    mock.timers.tick(1);
    fake.hang(false);
    assert.equal(await first, 2);
    assert.equal(await fake.probes(), 2);
  });

  // Out of time twice: unknown after two tries, not three, and asked again after 30 s.
  await withFakeOpenCode(async (fake) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    fake.answer('opencode v2.2.3');
    fake.hang(true);
    const stuck = readOpenCodeCliMajorVersion();
    assert.equal(await fake.waitForProbes(1), 1);
    mock.timers.tick(20_000);
    assert.equal(await fake.waitForProbes(2), 2);
    mock.timers.tick(20_000);
    assert.equal(await stuck, null);
    assert.equal(await fake.waitForProbes(3), 2);
    fake.hang(false);
    mock.timers.tick(29_000);
    assert.equal(await readOpenCodeCliMajorVersion(), null);
    mock.timers.tick(2_000);
    assert.equal(await readOpenCodeCliMajorVersion(), 2);
    assert.equal(await fake.probes(), 3);
  });
});

test('a replaced `opencode` that runs out of time gets no answer from the file it replaced', { skip: process.platform === 'win32' }, async () => {
  await withFakeOpenCode(async (fake) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    fake.answer('1.18.25');
    assert.equal(await readOpenCodeCliMajorVersion(), 1);

    // Upgraded to 2.x, whose first `--version` runs out of time: asked again, never answered with 1.
    fake.touch();
    fake.answer('opencode v2.2.3');
    fake.hang(true);
    const upgraded = readOpenCodeCliMajorVersion();
    assert.equal(await fake.waitForProbes(2), 2);
    mock.timers.tick(20_000);
    fake.hang(false);
    assert.equal(await upgraded, 2);

    // Downgraded to a 1.x that never answers in time: unknown, not 2.
    fake.touch();
    fake.answer('1.18.25');
    fake.hang(true);
    const downgraded = readOpenCodeCliMajorVersion();
    assert.equal(await fake.waitForProbes(4), 4);
    mock.timers.tick(20_000);
    assert.equal(await fake.waitForProbes(5), 5);
    mock.timers.tick(20_000);
    assert.equal(await downgraded, null);
  });
});

test('a file that answered is asked again within 5 s, and its answer stands when that runs out', { skip: process.platform === 'win32' }, async () => {
  await withFakeOpenCode(async (fake) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    fake.answer('opencode v2.2.3');
    assert.equal(await readOpenCodeCliMajorVersion(), 2);

    // Once the answer is old, the same file is asked again, and hangs: 5 s, then the answer stands.
    mock.timers.tick(5 * 60_000);
    fake.hang(true);
    const again = readOpenCodeCliMajorVersion();
    assert.equal(await fake.waitForProbes(2), 2);
    mock.timers.tick(4_999);
    assert.equal(await settledValue(again), 'pending');
    mock.timers.tick(1);
    assert.equal(await again, 2);
    // A known file gets no second try.
    assert.equal(await fake.waitForProbes(3), 2);

    // Not asked before the retry; then asked within 5 s again, and an error answer keeps no older one.
    fake.hang(false);
    fake.answer('opencode v2.2.3', 1);
    mock.timers.tick(29_000);
    assert.equal(await readOpenCodeCliMajorVersion(), 2);
    mock.timers.tick(2_000);
    assert.equal(await readOpenCodeCliMajorVersion(), null);
    assert.equal(await fake.probes(), 3);
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
