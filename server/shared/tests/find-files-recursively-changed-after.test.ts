import assert from 'node:assert/strict';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findFilesRecursivelyChangedAfter } from '@/shared/utils.js';

/**
 * A transcript is usually created long before the interesting thing happens to
 * it: a `/rename` in the CLI appends a `custom-title` row hours or days later,
 * changing the file's mtime without touching its birthtime. An incremental
 * scan keyed on creation time therefore never re-reads a renamed session — the
 * new title sits on disk, invisible, until the file happens to be recreated.
 */
test('findFilesRecursivelyChangedAfter picks up a file modified after the cursor', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scan-modified-'));

  try {
    const filePath = path.join(root, 'session.jsonl');
    await writeFile(filePath, '{}\n', 'utf8');

    // Created before the cursor; modified after it.
    const cursor = new Date(Date.now() - 60_000);
    await utimes(filePath, new Date(Date.now() - 120_000), new Date());

    const files = await findFilesRecursivelyChangedAfter(root, '.jsonl', cursor);

    assert.deepEqual(files, [filePath], 'a file modified after the cursor must be rescanned');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('findFilesRecursivelyChangedAfter skips a file untouched since the cursor', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scan-untouched-'));

  try {
    const oldPath = path.join(root, 'old-session.jsonl');
    await writeFile(oldPath, '{}\n', 'utf8');
    const stale = new Date(Date.now() - 120_000);
    await utimes(oldPath, stale, stale);

    const files = await findFilesRecursivelyChangedAfter(root, '.jsonl', new Date(Date.now() - 60_000));

    assert.deepEqual(files, [], 'an untouched file must not be rescanned');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
