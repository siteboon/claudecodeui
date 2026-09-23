import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import spawn from 'cross-spawn';
import express from 'express';

import { readWorkingTreeFileDiff } from '../git-file-diff.service.js';
import { createGitRouter } from '../git.routes.js';

// Mirrors FILE_DIFF_BYTE_LIMIT in the service.
const BYTE_LIMIT = 500_000;
// A cut diff/payload: the byte limit plus one '+'/'-' (and one JSON-escaped
// newline) per shown line. The fixtures below are 1.3-2.4 MB unbounded.
const TRUNCATED_CEILING = 600_000;

let repositoryRootPath = '';

const git = (...args: string[]) => execFileSync('git', args, { cwd: repositoryRootPath, encoding: 'utf8' });

// NUL bytes early on, like any real binary (images, archives, executables).
const binaryBytes = (size: number) => {
  const bytes = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 31) % 256;
  return bytes;
};

const numberedLines = (count: number, label: string) =>
  Array.from({ length: count }, (_, index) => `${label} line ${String(index).padStart(6, '0')}`).join('\n') + '\n';

// One very long line, like a committed minified bundle.
const minifiedLine = (length: number, label: string) => `var ${label}=1;`.repeat(Math.ceil(length / 8)).slice(0, length);

before(async () => {
  repositoryRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'git-file-diff-'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(repositoryRootPath, 'tracked.txt'), 'one\ntwo\nthree\n');
  await fs.writeFile(path.join(repositoryRootPath, 'staged.txt'), 'before\n');
  await fs.writeFile(path.join(repositoryRootPath, 'gone.txt'), 'hello\nworld\n');
  await fs.writeFile(path.join(repositoryRootPath, 'gone.bin'), binaryBytes(64_000));
  await fs.writeFile(path.join(repositoryRootPath, 'gone-big.txt'), numberedLines(100_000, 'old'));
  await fs.writeFile(path.join(repositoryRootPath, 'image.png'), binaryBytes(4_000));
  await fs.writeFile(path.join(repositoryRootPath, 'rewritten.txt'), numberedLines(40_000, 'old'));
  await fs.writeFile(path.join(repositoryRootPath, 'bundle.min.js'), minifiedLine(600_000, 'a'));
  git('add', '.');
  git('commit', '-qm', 'init');

  await fs.writeFile(path.join(repositoryRootPath, 'tracked.txt'), 'one\n2\nthree\n');
  await fs.writeFile(path.join(repositoryRootPath, 'staged.txt'), 'after\n');
  git('add', 'staged.txt');
  await fs.rm(path.join(repositoryRootPath, 'gone.txt'));
  await fs.rm(path.join(repositoryRootPath, 'gone.bin'));
  await fs.rm(path.join(repositoryRootPath, 'gone-big.txt'));
  await fs.writeFile(path.join(repositoryRootPath, 'image.png'), binaryBytes(5_000));
  await fs.writeFile(path.join(repositoryRootPath, 'rewritten.txt'), numberedLines(40_000, 'new'));
  await fs.writeFile(path.join(repositoryRootPath, 'bundle.min.js'), minifiedLine(600_000, 'b'));
  // 3-byte characters and no newline: 500,000 bytes is not a whole number of them.
  await fs.writeFile(path.join(repositoryRootPath, 'wide.txt'), '界'.repeat(200_000));
  await fs.writeFile(path.join(repositoryRootPath, 'notes.txt'), 'first\nsecond\n');
  await fs.writeFile(path.join(repositoryRootPath, 'artifact.bin'), binaryBytes(2 * 1024 * 1024));
  await fs.writeFile(path.join(repositoryRootPath, 'huge.log'), numberedLines(150_000, 'log'));
  await fs.mkdir(path.join(repositoryRootPath, 'new-folder'));
  await fs.writeFile(path.join(repositoryRootPath, 'new-folder', 'inside.txt'), 'inside\n');
});

after(async () => {
  await fs.rm(repositoryRootPath, { recursive: true, force: true });
});

// Counts every byte the service reads from disk, and proves it never decodes a whole file.
const createReadCountingFileSystem = () => {
  const counter = { bytesRead: 0 };
  const fileSystem = {
    stat: fs.stat,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      const read = handle.read.bind(handle) as (...readArgs: unknown[]) => Promise<{ bytesRead: number }>;
      return Object.assign(handle, {
        read: async (...readArgs: unknown[]) => {
          const result = await read(...readArgs);
          counter.bytesRead += result.bytesRead;
          return result;
        },
      });
    },
  } as unknown as Parameters<typeof readWorkingTreeFileDiff>[0]['fileSystem'];
  return { counter, fileSystem };
};

const readDiff = (repositoryRelativeFilePath: string, fileSystem = createReadCountingFileSystem().fileSystem) =>
  readWorkingTreeFileDiff({ repositoryRootPath, repositoryRelativeFilePath, fileSystem, spawnProcess: spawn });

test('a small untracked text file keeps the exact legacy diff', async () => {
  assert.deepEqual(await readDiff('notes.txt'), {
    diff: '--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1,3 @@\n+first\n+second\n+',
    isBinary: false,
    isTruncated: false,
  });
});

test('a small deleted text file keeps the exact legacy diff', async () => {
  assert.deepEqual(await readDiff('gone.txt'), {
    diff: '--- a/gone.txt\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-hello\n-world\n-',
    isBinary: false,
    isTruncated: false,
  });
});

test('a modified tracked file keeps the exact legacy (header-stripped) diff', async () => {
  assert.deepEqual(await readDiff('tracked.txt'), {
    diff: '@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n',
    isBinary: false,
    isTruncated: false,
  });
});

test('a staged-only change falls back to the cached diff', async () => {
  assert.deepEqual(await readDiff('staged.txt'), {
    diff: '@@ -1 +1 @@\n-before\n+after\n',
    isBinary: false,
    isTruncated: false,
  });
});

test('an untracked directory keeps the legacy placeholder text', async () => {
  // git status collapses a new folder to "?? new-folder/", which is what the panel sends back.
  assert.deepEqual(await readDiff('new-folder/'), {
    diff: 'Directory: new-folder/\n(Cannot show diff for directories)',
    isBinary: false,
    isTruncated: false,
  });
});

test('a large untracked binary is reported as binary without decoding the whole file', async () => {
  const { counter, fileSystem } = createReadCountingFileSystem();

  assert.deepEqual(await readDiff('artifact.bin', fileSystem), { diff: '', isBinary: true, isTruncated: false });
  assert.ok(counter.bytesRead <= BYTE_LIMIT, `read ${counter.bytesRead} bytes of a 2 MiB file`);
});

test('a deleted binary is reported as binary', async () => {
  assert.deepEqual(await readDiff('gone.bin'), { diff: '', isBinary: true, isTruncated: false });
});

test('a modified tracked binary is reported as binary instead of an empty diff', async () => {
  assert.deepEqual(await readDiff('image.png'), { diff: '', isBinary: true, isTruncated: false });
});

test('an oversized untracked text file is cut at the byte limit and flagged', async () => {
  const { counter, fileSystem } = createReadCountingFileSystem();
  const result = await readDiff('huge.log', fileSystem);

  assert.equal(result.isTruncated, true);
  assert.equal(result.isBinary, false);
  assert.ok(counter.bytesRead <= BYTE_LIMIT);
  const [header, ...addedLines] = result.diff.split('\n').slice(2);
  assert.equal(header, `@@ -0,0 +1,${addedLines.length} @@`);
  assert.equal(addedLines[0], '+log line 000000');
  // Whole lines up to where the read stopped, then the part of the next line that was read.
  assert.ok(addedLines.slice(0, -1).every((line) => /^\+log line \d{6}$/.test(line)));
  assert.ok('+log line 000000'.length >= addedLines[addedLines.length - 1].length);
  assert.equal(Buffer.byteLength(addedLines.map((line) => line.slice(1)).join('\n')), BYTE_LIMIT);
  assert.ok(result.diff.length < TRUNCATED_CEILING);
});

test('an oversized file cut inside a multi-byte character drops only that character', async () => {
  const result = await readDiff('wide.txt');

  assert.equal(result.isTruncated, true);
  assert.equal(result.diff.includes('\uFFFD'), false);
  const addedText = result.diff.split('\n')[3].slice(1);
  assert.equal(addedText, '界'.repeat(Math.floor(BYTE_LIMIT / 3)));
});

test('an oversized deleted text file is cut and flagged', async () => {
  const result = await readDiff('gone-big.txt');

  assert.equal(result.isTruncated, true);
  assert.ok(result.diff.startsWith('--- a/gone-big.txt\n+++ /dev/null\n@@ -1,'));
  const removedLines = result.diff.split('\n').slice(3);
  assert.ok(removedLines.slice(0, -1).every((line) => /^-old line \d{6}$/.test(line)));
  assert.ok(result.diff.length < TRUNCATED_CEILING);
});

test('an oversized tracked diff is cut and flagged', async () => {
  const result = await readDiff('rewritten.txt');

  assert.equal(result.isTruncated, true);
  assert.ok(result.diff.startsWith('@@ -1,40000 +1,40000 @@\n-old line 000000\n'));
  assert.ok(result.diff.length <= BYTE_LIMIT);
});

test('an oversized single-line (minified) change still has a preview', async () => {
  const result = await readDiff('bundle.min.js');

  assert.equal(result.isTruncated, true);
  assert.ok(result.diff.startsWith('@@ -1 +1 @@\n-var a=1;var a=1;'));
  // GitDiffViewer renders the first 200K characters, so the cut diff must still carry that many.
  assert.ok(result.diff.length > 400_000, `preview was only ${result.diff.length} characters`);
  assert.ok(result.diff.length <= BYTE_LIMIT);
});

test('a missing HEAD blob still surfaces the git failure', async () => {
  await assert.rejects(
    readWorkingTreeFileDiff({
      repositoryRootPath,
      repositoryRelativeFilePath: 'gone.txt',
      fileSystem: createReadCountingFileSystem().fileSystem,
      // Pretend status said "deleted" but the blob cannot be shown.
      spawnProcess: ((command: string, args: string[], options: object) => spawn(
        command,
        args[0] === 'show' ? ['show', 'HEAD:does-not-exist.txt'] : args,
        options,
      )) as typeof spawn,
    }),
    /Command failed: git show HEAD:gone\.txt/,
  );
});

test('GET /diff answers a large binary with a small payload and keeps `diff` for text files', async () => {
  const unexpectedProvider = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  const app = express();
  app.use('/api/git', createGitRouter({
    fileSystem: fs,
    spawnProcess: spawn,
    resolveProjectPathById: () => repositoryRootPath,
    queryClaude: unexpectedProvider,
    queryCursor: unexpectedProvider,
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address() as AddressInfo;
    const fetchDiff = async (file: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/git/diff?project=p&file=${encodeURIComponent(file)}`);
      const text = await response.text();
      return { bytes: Buffer.byteLength(text), body: JSON.parse(text) as Record<string, unknown> };
    };

    const binary = await fetchDiff('artifact.bin');
    assert.deepEqual(binary.body, { diff: '', isBinary: true, isTruncated: false });
    assert.ok(binary.bytes < 100, `binary response was ${binary.bytes} bytes`);

    const huge = await fetchDiff('huge.log');
    assert.equal(huge.body.isTruncated, true);
    assert.ok(huge.bytes < TRUNCATED_CEILING, `truncated response was ${huge.bytes} bytes`);

    const text = await fetchDiff('notes.txt');
    assert.equal(text.body.diff, '--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1,3 @@\n+first\n+second\n+');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
