import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import providerRoutes from '@/modules/providers/provider.routes.js';

test('Pi auth status route accepts the registered provider', { concurrency: false }, async () => {
  const previousCliPath = process.env.PI_CLI_PATH;
  process.env.PI_CLI_PATH = path.join(os.tmpdir(), 'cloudcli-test-missing-pi-cli');

  const app = express();
  app.use('/api/providers', providerRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/providers/pi/auth/status`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: {
        installed: false,
        provider: 'pi',
        authenticated: false,
        email: null,
        method: null,
        error: 'Pi CLI not installed',
      },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousCliPath === undefined) {
      delete process.env.PI_CLI_PATH;
    } else {
      process.env.PI_CLI_PATH = previousCliPath;
    }
  }
});
