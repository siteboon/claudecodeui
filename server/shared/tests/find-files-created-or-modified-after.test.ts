import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findFilesRecursivelyCreatedOrModifiedAfter } from '@/shared/utils.js';

async function withFixtureTree(runTest: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'find-files-modified-'));
  try {
    await runTest(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeFixtureFile(root: string, relativePath: string, content = ''): Promise<string> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

const relativeSorted = (root: string, files: string[]) =>
  files.map((filePath) => path.relative(root, filePath)).sort();

test('an incremental scan includes a file created before the cursor but modified after it', async () => {
  await withFixtureTree(async (root) => {
    // The cursor sits in the future, so every birthtime below is before it:
    // only the modification time can bring a file into range.
    const cursor = new Date(Date.now() + 60_000);
    const appendedAfterCursor = new Date(cursor.getTime() + 60_000);

    await writeFixtureFile(root, '-old-project/untouched.jsonl', '{}\n');
    const appended = await writeFixtureFile(root, '-new-project/appended.jsonl');
    await utimes(appended, appendedAfterCursor, appendedAfterCursor);

    const files = await findFilesRecursivelyCreatedOrModifiedAfter(root, '.jsonl', cursor);

    assert.deepEqual(relativeSorted(root, files), [path.join('-new-project', 'appended.jsonl')]);
  });
});

test('an incremental scan still includes a file created after the cursor whose mtime is older', async (t) => {
  await withFixtureTree(async (root) => {
    // A copy that preserved its source's mtime (`cp -p`, archive restores) is
    // only recognisably new by its birthtime.
    const cursor = new Date(Date.now() - 60_000);
    const copied = await writeFixtureFile(root, '-project/copied.jsonl', '{}\n');
    const preservedMtime = new Date('2020-01-01T00:00:00.000Z');
    await utimes(copied, preservedMtime, preservedMtime);
    // Some filesystems report no creation time (birthtimeMs 0), and HFS+/APFS
    // move it back when utimes() sets an mtime older than it.
    const { birthtime, birthtimeMs } = await stat(copied);
    if (birthtimeMs === 0 || birthtime < cursor) {
      t.skip('this filesystem did not keep a creation time after the cursor');
      return;
    }

    const files = await findFilesRecursivelyCreatedOrModifiedAfter(root, '.jsonl', cursor);

    assert.deepEqual(relativeSorted(root, files), [path.join('-project', 'copied.jsonl')]);
  });
});

test('an incremental scan includes a file whose mtime equals the cursor', async () => {
  await withFixtureTree(async (root) => {
    // The cursor is stored in whole seconds; a filesystem with 1-second
    // timestamps stamps a write made in that same second with exactly it.
    const cursor = new Date((Math.floor(Date.now() / 1000) + 60) * 1000);
    const sameSecond = await writeFixtureFile(root, '-project/same-second.jsonl', '{}\n');
    await utimes(sameSecond, cursor, cursor);

    const files = await findFilesRecursivelyCreatedOrModifiedAfter(root, '.jsonl', cursor);

    assert.deepEqual(relativeSorted(root, files), [path.join('-project', 'same-second.jsonl')]);
  });
});

test('a full rescan (null cursor) returns every matching file and nothing else', async () => {
  await withFixtureTree(async (root) => {
    await writeFixtureFile(root, '-a/one.jsonl', '{}\n');
    await writeFixtureFile(root, '-a/nested/two.jsonl', '{}\n');
    await writeFixtureFile(root, '-a/notes.txt', 'not a transcript');

    const files = await findFilesRecursivelyCreatedOrModifiedAfter(root, '.jsonl', null);

    assert.deepEqual(relativeSorted(root, files), [
      path.join('-a', 'nested', 'two.jsonl'),
      path.join('-a', 'one.jsonl'),
    ]);
  });
});

test('a missing root directory yields no files instead of throwing', async () => {
  const files = await findFilesRecursivelyCreatedOrModifiedAfter(
    path.join(os.tmpdir(), 'find-files-modified-missing', 'nope'),
    '.jsonl',
    new Date(),
  );

  assert.deepEqual(files, []);
});
