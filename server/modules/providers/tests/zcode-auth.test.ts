import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ZCodeProviderAuth } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { clearEnginePathCache } from '@/modules/providers/list/zcode/zcode-engine-path.js';

/**
 * Isolates engine resolution (temp engine file) and credential storage
 * (temp ZCODE_STORAGE_DIR) so auth detection is deterministic even on
 * machines with ZCode installed.
 */
const withZCodeAuthFixtures = async (
  runTest: (storageDir: string, enginePath: string) => Promise<void>,
): Promise<void> => {
  const previousStorage = process.env.ZCODE_STORAGE_DIR;
  const previousEngine = process.env.CLOUDCLI_ZCODE_ENGINE;

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zcode-auth-'));
  const storageDir = path.join(tempDir, 'storage');
  const enginePath = path.join(tempDir, 'zcode.cjs');
  await mkdir(path.join(storageDir, 'v2'), { recursive: true });
  await writeFile(enginePath, '#!/usr/bin/env node\n', 'utf8');

  process.env.ZCODE_STORAGE_DIR = storageDir;
  process.env.CLOUDCLI_ZCODE_ENGINE = enginePath;
  clearEnginePathCache();

  try {
    await runTest(storageDir, enginePath);
  } finally {
    if (previousStorage === undefined) {
      delete process.env.ZCODE_STORAGE_DIR;
    } else {
      process.env.ZCODE_STORAGE_DIR = previousStorage;
    }
    if (previousEngine === undefined) {
      delete process.env.CLOUDCLI_ZCODE_ENGINE;
    } else {
      process.env.CLOUDCLI_ZCODE_ENGINE = previousEngine;
    }
    clearEnginePathCache();
    await rm(tempDir, { recursive: true, force: true });
  }
};

test('getStatus reports authenticated when OAuth credentials exist', async () => {
  await withZCodeAuthFixtures(async (storageDir, enginePath) => {
    await writeFile(
      path.join(storageDir, 'v2', 'credentials.json'),
      JSON.stringify({
        'oauth:bigmodel:access_token': 'enc:v1:abc.def.ghi',
        'zcodejwttoken': 'enc:v1:jwt.salt.iv',
      }),
      'utf8'
    );

    const status = await new ZCodeProviderAuth().getStatus();

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, true);
    assert.equal(status.email, null);
    assert.equal(status.method, 'Z.AI OAuth');
    assert.equal(status.error, undefined);
    assert.equal(status.loginCommand, `node ${enginePath} login`);
  });
});

test('getStatus reports unauthenticated when the credential file is missing', async () => {
  await withZCodeAuthFixtures(async () => {
    const status = await new ZCodeProviderAuth().getStatus();

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, false);
    assert.ok(status.error?.includes('login'));
    assert.equal(status.loginCommand !== null, true);
  });
});

test('getStatus reports unauthenticated when no OAuth keys are present', async () => {
  await withZCodeAuthFixtures(async (storageDir) => {
    await writeFile(
      path.join(storageDir, 'v2', 'credentials.json'),
      JSON.stringify({ 'bot:bot-1:credential': 'enc:v1:x.y.z' }),
      'utf8'
    );

    const status = await new ZCodeProviderAuth().getStatus();

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, false);
  });
});

test('getStatus never throws for corrupted credential files', async () => {
  await withZCodeAuthFixtures(async (storageDir) => {
    await writeFile(path.join(storageDir, 'v2', 'credentials.json'), '{not json', 'utf8');

    const status = await new ZCodeProviderAuth().getStatus();

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, false);
    assert.ok(status.error?.includes('corrupted'));
  });
});
