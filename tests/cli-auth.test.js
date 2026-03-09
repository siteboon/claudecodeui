import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import cliAuthRouter from '../server/routes/cli-auth.js';

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    process.env[key] = value;
  }
}

test('claude status authenticates when ANTHROPIC_AUTH_TOKEN is set', async () => {
  const envSnapshot = { ...process.env };
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccui-auth-test-'));

  const app = express();
  app.use('/api/cli-auth', cliAuthRouter);
  const server = app.listen(0);

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-auth-token';
    process.env.HOME = tempHome;

    const address = server.address();
    assert.ok(address && typeof address === 'object' && 'port' in address);

    const response = await fetch(`http://127.0.0.1:${address.port}/api/cli-auth/claude/status`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.authenticated, true);
    assert.equal(payload.method, 'api_key');
  } finally {
    server.close();
    restoreEnv(envSnapshot);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});
