import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

// The composition root reads `UPLOAD_MAX_FILE_SIZE_MB` and picks multer's temp
// directory once, when it is first imported, so both have to be in place before
// that import. A 1 MB cap keeps the test uploads small, and the private temp
// directory lets the test see whether a rejected upload leaves a file behind.
// An upload that passes the cap reaches the project lookup, so DATABASE_PATH
// points at a throwaway file instead of whatever database the shell names.
// Parsing of the variable itself is covered in server/shared/tests.
const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'file-tree-upload-limits-'));
const uploadTemporaryDirectory = path.join(fixtureDirectory, 'uploads');
await mkdir(uploadTemporaryDirectory);
const previousUploadLimit = process.env.UPLOAD_MAX_FILE_SIZE_MB;
const previousTemporaryDirectory = process.env.TMPDIR;
const previousDatabasePath = process.env.DATABASE_PATH;
process.env.UPLOAD_MAX_FILE_SIZE_MB = '1';
process.env.TMPDIR = uploadTemporaryDirectory;
process.env.DATABASE_PATH = path.join(fixtureDirectory, 'auth.db');

const { fileTreeRoutes } = await import('@/modules/file-tree/file-tree.module.js');

if (previousTemporaryDirectory === undefined) {
  delete process.env.TMPDIR;
} else {
  process.env.TMPDIR = previousTemporaryDirectory;
}
if (previousUploadLimit === undefined) {
  delete process.env.UPLOAD_MAX_FILE_SIZE_MB;
} else {
  process.env.UPLOAD_MAX_FILE_SIZE_MB = previousUploadLimit;
}

test.after(async () => {
  if (previousDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDatabasePath;
  }
  await rm(fixtureDirectory, { recursive: true, force: true });
});

async function withFileTreeServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use('/api/file-tree', fileTreeRoutes);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('upload limits route reports the cap configured through UPLOAD_MAX_FILE_SIZE_MB', async () => {
  await withFileTreeServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/file-tree/upload-limits`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { maximumFileSizeMegabytes: 1, maximumFileCount: 20 });
  });
});

test('upload route enforces the configured cap and removes the rejected temp file', async () => {
  await withFileTreeServer(async (baseUrl) => {
    const formData = new FormData();
    formData.append('files', new Blob([new Uint8Array(1.5 * 1024 * 1024)]), 'over-limit.bin');

    const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files/upload`, {
      method: 'POST',
      body: formData,
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'File too large. Maximum size is 1MB.' });
  });

  assert.deepEqual(await readdir(uploadTemporaryDirectory), []);
});

test('upload cap counts binary megabytes, so a file just under 1 MiB passes a 1 MB cap', async () => {
  // 1,048,575 bytes is over a decimal megabyte: a cap computed as 1,000,000 bytes would
  // answer the 400 below. (Busboy rejects a file that reaches the byte limit exactly.)
  await withFileTreeServer(async (baseUrl) => {
    const formData = new FormData();
    formData.append('files', new Blob([new Uint8Array(1024 * 1024 - 1)]), 'under-limit.bin');

    const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files/upload`, {
      method: 'POST',
      body: formData,
    });

    // Past the size check the upload goes on to the project lookup, which the
    // fixture's empty database cannot answer; only the size check's 400 matters here.
    const body = await response.json() as { error?: string };
    assert.notEqual(response.status, 400, body.error);
    assert.doesNotMatch(String(body.error), /File too large/);
  });

  assert.deepEqual(await readdir(uploadTemporaryDirectory), []);
});
