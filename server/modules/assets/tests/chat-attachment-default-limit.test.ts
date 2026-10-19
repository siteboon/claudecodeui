import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

/**
 * Without CHAT_ATTACHMENT_MAX_SIZE_MB the limit stays 10 MB, and a file of
 * exactly 10 MB is accepted: the composer only refuses files larger than the
 * limit, so a server that refused the exact size made such a file pass the
 * composer and then fail on send. Runs in its own process because the router
 * reads the variable once, at load.
 */

const DEFAULT_LIMIT_BYTES = 10 * 1024 * 1024;

const previousLimit = process.env.CHAT_ATTACHMENT_MAX_SIZE_MB;
const previousHome = process.env.HOME;
const scratchHome = await mkdtemp(path.join(os.tmpdir(), 'chat-attachment-default-limit-'));
delete process.env.CHAT_ATTACHMENT_MAX_SIZE_MB;
process.env.HOME = scratchHome;

const { assetsRoutes } = await import('@/modules/assets/index.js');

test.after(async () => {
  if (previousLimit !== undefined) {
    process.env.CHAT_ATTACHMENT_MAX_SIZE_MB = previousLimit;
  }
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  await rm(scratchHome, { recursive: true, force: true });
});

test('the default limit is 10 MB, inclusive, and the composer is told so', async () => {
  const app = express().use('/api/assets', assetsRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/assets`;

  const upload = async (name: string, size: number) => {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(size)]), name);
    const response = await fetch(`${baseUrl}/files`, { method: 'POST', body: form });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  try {
    const limits = await fetch(`${baseUrl}/limits`);
    assert.deepEqual(await limits.json(), { maxFileSizeBytes: DEFAULT_LIMIT_BYTES });

    const exactlyTenMegabytes = await upload('ten-mb.log', DEFAULT_LIMIT_BYTES);
    assert.equal(exactlyTenMegabytes.status, 200, JSON.stringify(exactlyTenMegabytes.body));

    const oneByteOver = await upload('ten-mb-plus-one.log', DEFAULT_LIMIT_BYTES + 1);
    assert.equal(oneByteOver.status, 400);
    assert.equal(oneByteOver.body.error, 'File too large. Maximum size is 10 MB.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
