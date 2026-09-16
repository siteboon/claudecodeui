import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import assetsRoutes from '@/modules/assets/assets.routes.js';

/**
 * Runs the assets router against a throwaway home directory so uploads land
 * in a temporary `.cloudcli/assets` folder instead of the real one.
 */
async function withAssetsServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-assets-test-'));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;

  const app = express();
  app.use('/api/assets', assetsRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    process.env.HOME = previousHome;
    process.env.USERPROFILE = previousUserProfile;
    await fs.rm(fakeHome, { recursive: true, force: true });
  }
}

test('file upload keeps non-ASCII original filenames intact', async () => {
  await withAssetsServer(async (baseUrl) => {
    const originalName = '개인정보 처리방침 안내서.pdf';
    const form = new FormData();
    form.append('files', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), originalName);

    const response = await fetch(`${baseUrl}/api/assets/files`, { method: 'POST', body: form });
    assert.equal(response.status, 200);

    const body = await response.json() as { attachments: Array<{ name: string }> };
    assert.equal(body.attachments.length, 1);
    assert.equal(body.attachments[0].name, originalName);
  });
});

test('image upload keeps non-ASCII original filenames intact', async () => {
  await withAssetsServer(async (baseUrl) => {
    const originalName = 'スクリーンショット.png';
    const form = new FormData();
    form.append('images', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), originalName);

    const response = await fetch(`${baseUrl}/api/assets/images`, { method: 'POST', body: form });
    assert.equal(response.status, 200);

    const body = await response.json() as { images: Array<{ name: string }> };
    assert.equal(body.images.length, 1);
    assert.equal(body.images[0].name, originalName);
  });
});
