import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import type { WebSocket } from 'ws';

import { closeConnection, initializeDatabase, notificationPreferencesDb, userDb } from '@/modules/database/index.js';
import { registerDesktopNotificationClient, unregisterDesktopNotificationClient } from '@/modules/notifications/index.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/index.js';

import { kiroRuntime } from '../list/kiro/kiro-runtime.provider.js';

const runtimeContext: ProviderRuntimeContext = {
  resolveProviderSessionId: () => null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'auto' }),
  normalizeMessage: () => [],
  isProviderInstalled: async () => true,
};

for (const scenario of ['early-abort', 'abort-prompt', 'success', 'rpc-error']) {
  test(`Kiro reports exactly one lifecycle notification for ${scenario}`, { timeout: 10_000 }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'kiro-notifications-'));
    const environmentKeys = ['DATABASE_PATH', 'KIRO_PATH', 'KIRO_TEST_LOG', 'KIRO_TEST_SCENARIO'] as const;
    const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
    const payloads: Array<{ body: string; data: { code: string; provider: string; sessionId: string } }> = [];
    const events: NormalizedMessage[] = [];
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: (message: string) => { payloads.push(JSON.parse(message).payload); },
      close: () => {},
    } as unknown as WebSocket;
    const sessionId = `kiro-notification-${scenario}`;
    let running: Promise<unknown> | undefined;

    closeConnection();
    try {
      process.env.DATABASE_PATH = path.join(directory, 'auth.db');
      process.env.KIRO_TEST_LOG = path.join(directory, 'requests.jsonl');
      process.env.KIRO_TEST_SCENARIO = scenario;
      const script = path.join(directory, 'fake-acp.cjs');
      await copyFile(new URL('../list/kiro/__tests__/fixtures/fake-acp.cjs', import.meta.url), script);
      await chmod(script, 0o755);
      process.env.KIRO_PATH = script;
      if (process.platform === 'win32') {
        process.env.KIRO_PATH = path.join(directory, 'fake-acp.cmd');
        await writeFile(process.env.KIRO_PATH, `@"${process.execPath}" "${script}" %*\r\n`);
      }
      await initializeDatabase();
      const userId = Number(userDb.createUser(`kiro-${scenario}`, 'x').id);
      notificationPreferencesDb.updatePreferences(userId, {
        channels: { desktop: true },
        events: { stop: true, error: true },
      });
      registerDesktopNotificationClient({ userId, deviceId: 'kiro-test', ws: socket });
      running = kiroRuntime.run('hello', { sessionId, cwd: directory }, {
        userId,
        send: (message: unknown) => { events.push(message as NormalizedMessage); },
      }, runtimeContext);
      // Observe rejection immediately while the child process starts.
      const settled = running.then(() => null, (error: unknown) => error);
      const cancelled = scenario === 'early-abort' || scenario === 'abort-prompt';
      if (cancelled) {
        const method = scenario === 'early-abort' ? 'initialize' : 'session/prompt';
        let received = false;
        for (let attempt = 0; attempt < 300; attempt += 1) {
          const log = await readFile(process.env.KIRO_TEST_LOG, 'utf8').catch(() => '');
          received = log.split('\n').filter(Boolean).some((line) => JSON.parse(line).method === method);
          if (received) break;
          await delay(10);
        }
        assert.ok(received, `No ${method} request received`);
        assert.equal(kiroRuntime.abort(sessionId), true);
      }
      const error = await settled;
      if (scenario === 'rpc-error') assert.match(String(error), /prompt failed/);
      else assert.equal(error, null);

      assert.equal(payloads.length, 1);
      assert.equal(payloads[0].data.code, scenario === 'rpc-error' ? 'run.failed' : 'run.stopped');
      assert.equal(payloads[0].data.provider, 'kiro');
      assert.equal(payloads[0].data.sessionId, sessionId);
      if (cancelled) assert.match(payloads[0].body, /aborted$/);
      if (scenario === 'success') assert.match(payloads[0].body, /completed$/);
      // The gateway owns the terminal event for cancellation, the runtime owns its notification.
      assert.equal(events.filter((event) => event.kind === 'complete').length, cancelled ? 0 : 1);
      assert.equal(kiroRuntime.abort(sessionId), false);
    } finally {
      kiroRuntime.abort(sessionId);
      await running?.catch(() => {});
      unregisterDesktopNotificationClient(socket);
      closeConnection();
      for (const [key, value] of savedEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}
