import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { voiceRoutes } from '../index.js';

test('voice uploads reject nested multipart fields', async () => {
  const app = express().use('/api/voice', voiceRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const form = new FormData();
    form.set('nested[value]', 'blocked');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/voice/transcribe`, {
      method: 'POST',
      body: form,
    });
    const body = await response.json() as { error: string };

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Field name nesting too deep');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
