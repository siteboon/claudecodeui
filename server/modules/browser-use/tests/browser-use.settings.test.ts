import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import router from '@/modules/browser-use/browser-use.routes.js';
import { BrowserSettingsApplyError, browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { appConfigDb } from '@/modules/database/index.js';

test('failed registration preserves the saved setting and reports a safe retryable failure', async (t) => {
  let stored = JSON.stringify({ enabled: false });
  t.mock.method(appConfigDb, 'get', () => stored);
  t.mock.method(appConfigDb, 'set', (_key: string, value: string) => { stored = value; });
  const registration = t.mock.method(browserUseService, 'registerAgentMcp', async () => {
    throw new Error('synthetic provider command --token=DO_NOT_EXPOSE');
  });

  await assert.rejects(browserUseService.updateSettings({ enabled: true }), (error: unknown) => {
    assert(error instanceof BrowserSettingsApplyError);
    assert.match(error.message, /settings were saved/);
    assert(!error.message.includes('DO_NOT_EXPOSE'));
    return true;
  });
  assert.deepEqual(await browserUseService.getSettings(), { enabled: true });
  registration.mock.mockImplementation(async () => ({ name: 'test-browser', command: 'node', args: [], results: [] }));
  assert.deepEqual(await browserUseService.updateSettings({ enabled: true }), { enabled: true });
  assert.equal(registration.mock.callCount(), 2);
});

test('an explicit disable retries cleanup even if the previous failure already saved false', async (t) => {
  let stored = JSON.stringify({ enabled: true });
  t.mock.method(appConfigDb, 'get', () => stored);
  t.mock.method(appConfigDb, 'set', (_key: string, value: string) => { stored = value; });
  const cleanup = t.mock.method(browserUseService, 'unregisterAgentMcp', async () => { throw new Error('synthetic failure'); });
  const stop = t.mock.method(browserUseService, 'stopAllSessions', async () => undefined);
  await assert.rejects(browserUseService.updateSettings({ enabled: false }), BrowserSettingsApplyError);
  assert.deepEqual(await browserUseService.getSettings(), { enabled: false });
  cleanup.mock.mockImplementation(async () => ({ name: 'test-browser', results: [] }));
  assert.deepEqual(await browserUseService.updateSettings({ enabled: false }), { enabled: false });
  assert.equal(cleanup.mock.callCount(), 2);
  assert.equal(stop.mock.callCount(), 1);
});

test('persistence failure is not mislabeled as a saved setting', async (t) => {
  t.mock.method(appConfigDb, 'get', () => JSON.stringify({ enabled: false }));
  const failure = new Error('synthetic persistence failure');
  t.mock.method(appConfigDb, 'set', () => { throw failure; });
  const registration = t.mock.method(browserUseService, 'registerAgentMcp');
  await assert.rejects(browserUseService.updateSettings({ enabled: true }), failure);
  assert.equal(registration.mock.callCount(), 0);
});

test('settings route returns safe codes and logs no raw provider exception', async (t) => {
  let failure: Error | null = null;
  t.mock.method(browserUseService, 'updateSettings', async () => {
    if (failure) throw failure;
    return { enabled: true };
  });
  const warnings = t.mock.method(console, 'warn', () => undefined);
  const app = express();
  app.use(express.json(), router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/settings`;
  const save = () => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":true}' });
  assert.equal((await save()).status, 200);
  failure = new BrowserSettingsApplyError();
  const partial = await save();
  assert.equal(partial.status, 500);
  const partialBody = await partial.json() as { error: { code: string } };
  assert.equal(partialBody.error.code, 'BROWSER_USE_SETTINGS_APPLY_FAILED');
  failure = new Error('command --secret=DO_NOT_EXPOSE');
  const generic = await save();
  assert.equal(generic.status, 400);
  const body = await generic.json() as { error: { code: string; details?: unknown } };
  assert.equal(body.error.code, 'BROWSER_USE_SETTINGS_SAVE_FAILED');
  assert.equal(body.error.details, undefined);
  assert(!JSON.stringify(body).includes('DO_NOT_EXPOSE'));
  assert(!JSON.stringify(warnings.mock.calls).includes('DO_NOT_EXPOSE'));
});
