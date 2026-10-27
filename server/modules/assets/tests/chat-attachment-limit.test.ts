import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

/**
 * CHAT_ATTACHMENT_MAX_SIZE_MB sets the per-file limit of chat attachment
 * uploads, and GET /api/assets/limits hands the same number to the composer so
 * the browser never carries its own copy. The router reads the variable once,
 * at load, so this file sets it (and a scratch HOME for the upload folder)
 * before importing the router. The default-limit cases live in
 * chat-attachment-default-limit.test.ts, which runs in its own process.
 */

const MEGABYTE = 1024 * 1024;

const previousLimit = process.env.CHAT_ATTACHMENT_MAX_SIZE_MB;
const previousHome = process.env.HOME;
const scratchHome = await mkdtemp(path.join(os.tmpdir(), 'chat-attachment-limit-'));
process.env.CHAT_ATTACHMENT_MAX_SIZE_MB = '1';
process.env.HOME = scratchHome;

const { default: assetsRouter, resolveChatAttachmentMaxSizeMb } = await import('@/modules/assets/assets.routes.js');

test.after(async () => {
  for (const [name, value] of [
    ['CHAT_ATTACHMENT_MAX_SIZE_MB', previousLimit],
    ['HOME', previousHome],
  ] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await rm(scratchHome, { recursive: true, force: true });
});

async function withAssetsServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express().use('/api/assets', assetsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/assets`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function uploadFileOfSize(baseUrl: string, name: string, size: number) {
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(size)]), name);
  const response = await fetch(`${baseUrl}/files`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const collectWarnings = () => {
  const warnings: string[] = [];
  return { warnings, warn: (message: string) => { warnings.push(message); } };
};

test('an unset or blank limit keeps the 10 MB default without a warning', () => {
  const { warnings, warn } = collectWarnings();
  assert.equal(resolveChatAttachmentMaxSizeMb(undefined, warn), 10);
  assert.equal(resolveChatAttachmentMaxSizeMb('', warn), 10);
  assert.equal(resolveChatAttachmentMaxSizeMb('   ', warn), 10);
  assert.deepEqual(warnings, []);
});

test('a whole number of megabytes is used as given', () => {
  const { warnings, warn } = collectWarnings();
  assert.equal(resolveChatAttachmentMaxSizeMb('50', warn), 50);
  assert.equal(resolveChatAttachmentMaxSizeMb(' 25 ', warn), 25);
  assert.equal(resolveChatAttachmentMaxSizeMb('1', warn), 1);
  assert.deepEqual(warnings, []);
});

test('a value that is not a whole number of at least 1 MB falls back to the default with a warning', () => {
  for (const value of ['0', '-5', '1.5', '50MB', '1e3', 'abc', '99999999999999']) {
    const { warnings, warn } = collectWarnings();
    assert.equal(resolveChatAttachmentMaxSizeMb(value, warn), 10, value);
    assert.equal(warnings.length, 1, value);
    assert.match(warnings[0], /CHAT_ATTACHMENT_MAX_SIZE_MB/);
  }
});

test('GET /limits reports the configured limit in bytes', async () => {
  await withAssetsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/limits`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { maxFileSizeBytes: MEGABYTE });
  });
});

test('uploads up to and including the configured limit are stored; one byte more is refused with the limit', async () => {
  await withAssetsServer(async (baseUrl) => {
    const atLimit = await uploadFileOfSize(baseUrl, 'at-limit.log', MEGABYTE);
    assert.equal(atLimit.status, 200, JSON.stringify(atLimit.body));
    const [record] = atLimit.body.attachments as Array<{ name: string; size: number }>;
    assert.equal(record.name, 'at-limit.log');
    assert.equal(record.size, MEGABYTE);

    const overLimit = await uploadFileOfSize(baseUrl, 'over-limit.log', MEGABYTE + 1);
    assert.equal(overLimit.status, 400);
    assert.equal(overLimit.body.error, 'File too large. Maximum size is 1 MB.');

    // The refused upload leaves nothing behind in the assets folder.
    const stored = await readdir(path.join(scratchHome, '.cloudcli', 'assets'));
    assert.deepEqual(stored.filter((name) => name.endsWith('over-limit.log')), []);
  });
});
