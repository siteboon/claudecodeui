import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

// @ts-expect-error -- web-push does not provide declarations in this project.
import webPush from 'web-push';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  pushSubscriptionsDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';

import {
  buildNotificationPayload,
  createNotificationEvent,
  notifyUserIfEnabled,
} from '../services/notification-orchestrator.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'notification-orchestrator-'));
  const databasePath = path.join(temporaryDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('notification payload uses the app session id for a provider session id', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-session-1', 'claude-native-1');

    const payload = buildNotificationPayload({
      provider: 'claude',
      sessionId: 'claude-native-1',
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason: 'completed' },
    });

    assert.equal(payload.data.sessionId, 'app-session-1');
    assert.match(payload.data.tag, /app-session-1/);
  });
});

const APPLE_DEVICE_TOKEN = 'QAbCdEfGhIjKlMnOpQrStUvWxYz0123456789fakeDeviceToken';
const APPLE_ENDPOINT = `https://web.push.apple.com/${APPLE_DEVICE_TOKEN}`;

type PushDeliveryOutcome = { warnings: string[]; storedEndpoints: string[] };

/**
 * Sends one notification through the real web push channel to a single stored
 * subscription while web-push fails with `failure`, and reports what was logged
 * and which subscriptions survived.
 */
async function deliverFailingWebPush(failure: unknown): Promise<PushDeliveryOutcome> {
  let outcome: PushDeliveryOutcome = { warnings: [], storedEndpoints: [] };

  await withIsolatedDatabase(async () => {
    const userId = Number(userDb.createUser('push-user', 'hash').id);
    pushSubscriptionsDb.saveSubscription(userId, APPLE_ENDPOINT, 'p256dh-key', 'auth-key');
    const preferences = notificationPreferencesDb.getPreferences(userId);
    notificationPreferencesDb.updatePreferences(userId, {
      ...preferences,
      channels: { ...preferences.channels, webPush: true, desktop: false },
    });

    const sendNotification = mock.method(webPush, 'sendNotification', () => Promise.reject(failure));
    const warnings: string[] = [];
    const warn = mock.method(console, 'warn', (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });

    try {
      notifyUserIfEnabled({
        userId,
        event: {
          ...createNotificationEvent({ provider: 'system', code: 'push.enabled' }),
          // Unique per call so the 20 s duplicate filter never swallows a test's send.
          dedupeKey: `web-push-failure:${Math.random()}`,
        },
      });
      // Delivery is fire-and-forget; its result handling settles within the microtask queue.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(sendNotification.mock.callCount(), 1);
      outcome = {
        warnings,
        storedEndpoints: pushSubscriptionsDb.getSubscriptions(userId).map((row) => row.endpoint),
      };
    } finally {
      sendNotification.mock.restore();
      warn.mock.restore();
    }
  });

  return outcome;
}

// Shape of web-push's WebPushError for a non-2xx push service response.
function pushServiceResponse(statusCode: number, body: string) {
  return Object.assign(new Error('Received unexpected response code'), {
    statusCode,
    body,
    endpoint: APPLE_ENDPOINT,
  });
}

test('a push service rejection is logged with its status and reason, never the device token', async () => {
  const { warnings, storedEndpoints } = await deliverFailingWebPush(
    pushServiceResponse(403, '{"reason":"BadJwtToken"}'),
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[WebPush\]/);
  assert.match(warnings[0], /web\.push\.apple\.com/);
  assert.match(warnings[0], /403/);
  assert.match(warnings[0], /BadJwtToken/);
  assert.ok(!warnings[0].includes(APPLE_DEVICE_TOKEN));
  // A rejected JWT is the server's fault, so the subscription itself stays.
  assert.deepEqual(storedEndpoints, [APPLE_ENDPOINT]);
});

test('a push service response that echoes the endpoint is logged without it', async () => {
  const { warnings } = await deliverFailingWebPush(
    pushServiceResponse(400, `Bad device token for ${APPLE_ENDPOINT}`),
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /400 Bad device token for <endpoint>/);
  assert.ok(!warnings[0].includes(APPLE_DEVICE_TOKEN));
});

test('a web push network failure is logged with its error message', async () => {
  const { warnings, storedEndpoints } = await deliverFailingWebPush(
    new Error('getaddrinfo ENOTFOUND web.push.apple.com'),
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ENOTFOUND/);
  assert.deepEqual(storedEndpoints, [APPLE_ENDPOINT]);
});

test('an expired push subscription (404/410) is removed without a warning', async () => {
  for (const statusCode of [404, 410]) {
    const { warnings, storedEndpoints } = await deliverFailingWebPush(pushServiceResponse(statusCode, ''));

    assert.deepEqual(warnings, [], String(statusCode));
    assert.deepEqual(storedEndpoints, [], String(statusCode));
  }
});
