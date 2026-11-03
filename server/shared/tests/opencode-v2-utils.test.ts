import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  readOpenCodeCliMajorVersion,
  readOpenCodeSessionTable,
  unquoteOpenCodeRunMessage,
} from '@/shared/utils.js';

test('a prompt is recovered from the quotes `opencode run` stored it in', () => {
  // What `run` stores for one argument with a space: wrapped, inner quotes escaped.
  assert.equal(unquoteOpenCodeRunMessage('"say \\"hi\\" now"'), 'say "hi" now');
  assert.equal(unquoteOpenCodeRunMessage('"first line\nsecond line"'), 'first line\nsecond line');
  assert.equal(unquoteOpenCodeRunMessage('"keep a \\\\" backslash"'), 'keep a \\" backslash');
  assert.equal(unquoteOpenCodeRunMessage('" -v leading dash"'), ' -v leading dash');
  // An argument without a space is stored as it is, quotes and all.
  assert.equal(unquoteOpenCodeRunMessage('"hi"'), '"hi"');
  assert.equal(unquoteOpenCodeRunMessage('hello'), 'hello');
  // Text `run` cannot have produced is left alone.
  assert.equal(unquoteOpenCodeRunMessage('"two" "arguments"'), '"two" "arguments"');
  assert.equal(unquoteOpenCodeRunMessage('"unescaped " quote"'), '"unescaped " quote"');
  assert.equal(unquoteOpenCodeRunMessage('"'), '"');
});

const createDatabase = (tables: Record<string, number[]>) => {
  const db = new Database(':memory:');
  for (const [table, updates] of Object.entries(tables)) {
    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, time_updated INTEGER NOT NULL)`);
    updates.forEach((timeUpdated, index) => {
      db.prepare(`INSERT INTO ${table} (id, time_updated) VALUES (?, ?)`).run(`ses_${index}`, timeUpdated);
    });
  }
  return db;
};

test('the live OpenCode session table is the one the installed CLI writes', () => {
  const cases: Array<[Record<string, number[]>, string | null]> = [
    [{ session: [1, 2] }, 'session'],
    [{ session_v2: [1, 2] }, 'session_v2'],
    [{}, null],
    // Just upgraded: 2.x copied every 1.x session.
    [{ session: [1, 2], session_v2: [1, 2] }, 'session_v2'],
    [{ session: [1, 2], session_v2: [1, 2, 3] }, 'session_v2'],
    // A downgraded 1.x CLI wrote the 1.x tables after the upgrade.
    [{ session: [1, 2, 4], session_v2: [1, 2, 3] }, 'session'],
    [{ session: [], session_v2: [] }, 'session_v2'],
  ];

  for (const [tables, expected] of cases) {
    const db = createDatabase(tables);
    try {
      assert.equal(readOpenCodeSessionTable(db), expected, JSON.stringify(tables));
    } finally {
      db.close();
    }
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
