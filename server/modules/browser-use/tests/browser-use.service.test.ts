import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { appConfigDb } from '@/modules/database/index.js';

const require = createRequire(import.meta.url);

test('browser monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});

test('browser readiness accepts a configured executable without a Playwright browser download', async (t) => {
  let bundledPath: string;
  try {
    bundledPath = require('playwright').chromium.executablePath();
  } catch {
    t.skip('Playwright is optional');
    return;
  }
  const key = 'CLOUDCLI_BROWSER_USE_CHROMIUM_PATH';
  const previous = process.env[key];
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
  t.mock.method(appConfigDb, 'get', () => '{"enabled":true}');
  const { chromium } = require('playwright');
  const bundledPathProbe = t.mock.method(chromium, 'executablePath', () => bundledPath + '.missing');
  process.env[key] = process.execPath;

  const status = await browserUseService.getStatus();
  assert.equal(status.available, true);
  assert.equal(bundledPathProbe.mock.callCount(), 0);

  const install = await browserUseService.installRuntime();
  assert.equal(install.success, true);
  assert.equal(install.status.available, true);

  process.env[key] = 'relative-chromium';
  const invalidInstall = await browserUseService.installRuntime();
  assert.equal(invalidInstall.success, false);
  assert.equal(invalidInstall.status.available, false);
  assert.match(invalidInstall.status.message, /CLOUDCLI_BROWSER_USE_CHROMIUM_PATH/);
});
