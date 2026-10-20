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
type FakePushSend = (endpoint: string, options: unknown) => Promise<unknown>;

/**
 * Sends one notification through the real web push channel to the given stored
 * subscriptions while web-push answers each request through `send`, and reports
 * what was logged and which subscriptions survived.
 */
async function deliverWebPush(endpoints: string[], send: FakePushSend): Promise<PushDeliveryOutcome> {
  let outcome: PushDeliveryOutcome = { warnings: [], storedEndpoints: [] };

  await withIsolatedDatabase(async () => {
    const userId = Number(userDb.createUser('push-user', 'hash').id);
    for (const endpoint of endpoints) {
      pushSubscriptionsDb.saveSubscription(userId, endpoint, 'p256dh-key', 'auth-key');
    }
    const preferences = notificationPreferencesDb.getPreferences(userId);
    notificationPreferencesDb.updatePreferences(userId, {
      ...preferences,
      channels: { ...preferences.channels, webPush: true, desktop: false },
    });

    const sendNotification = mock.method(
      webPush,
      'sendNotification',
      (subscription: { endpoint: string }, _payload: string, options: unknown) => send(subscription.endpoint, options),
    );
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

      assert.equal(sendNotification.mock.callCount(), endpoints.length);
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

/** Like deliverWebPush() for one Apple subscription whose request fails with `failure`. */
function deliverFailingWebPush(failure: unknown): Promise<PushDeliveryOutcome> {
  return deliverWebPush([APPLE_ENDPOINT], () => Promise.reject(failure));
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

test('each failed subscription is logged on one plain line, with the reason capped at 200 chars', async () => {
  const fcmEndpoint = 'https://fcm.googleapis.com/fcm/send/fakeFcmRegistrationToken0123456789';
  const malformedEndpoint = 'not-a-push-endpoint';
  const failures = new Map<string, unknown>([
    [APPLE_ENDPOINT, pushServiceResponse(410, '')],
    // Terminal escapes and line breaks from a push service must not reach the log as such.
    [fcmEndpoint, pushServiceResponse(500, `\x1b[31mRED\x1b[0m\r\n[ERROR] forged line\t${'x'.repeat(500)}`)],
    [malformedEndpoint, new Error('Invalid endpoint')],
  ]);

  const { warnings, storedEndpoints } = await deliverWebPush([...failures.keys()], (endpoint) =>
    Promise.reject(failures.get(endpoint)),
  );

  assert.equal(warnings.length, 2, warnings.join('\n'));
  const fcmWarning = warnings.find((warning) => warning.includes('Delivery to fcm.googleapis.com'));
  assert.ok(fcmWarning, warnings.join('\n'));
  assert.doesNotMatch(fcmWarning, /\p{Cc}/u);
  const fcmDetail = fcmWarning.slice(fcmWarning.indexOf('HTTP 500'));
  assert.ok(fcmDetail.startsWith('HTTP 500 [31mRED [0m [ERROR] forged line xxx'), fcmDetail);
  assert.equal(fcmDetail.length, 200);
  assert.ok(
    warnings.some((warning) => warning.includes('Delivery to unknown push service') && warning.includes('Invalid endpoint')),
    warnings.join('\n'),
  );
  // Only the expired (410) subscription is removed.
  assert.deepEqual(storedEndpoints.sort(), [fcmEndpoint, malformedEndpoint].sort());
});

test('a push service that never answers does not hold back logging and cleanup of the others', async () => {
  const unresponsiveEndpoint = 'https://push.example.net/never-answers';

  const { warnings, storedEndpoints } = await deliverWebPush([APPLE_ENDPOINT, unresponsiveEndpoint], (endpoint, options) => {
    if (endpoint === APPLE_ENDPOINT) return Promise.reject(pushServiceResponse(410, ''));
    // Stands in for web-push, which has no default timeout: with a `timeout` option an unanswered
    // request fails as "Socket timeout" (here at once); without one it waits forever.
    const timeout = (options as { timeout?: unknown } | undefined)?.timeout;
    return typeof timeout === 'number' && timeout > 0
      ? Promise.reject(new Error('Socket timeout'))
      : new Promise(() => {});
  });

  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /Delivery to push\.example\.net failed for user \d+: Socket timeout/);
  assert.deepEqual(storedEndpoints, [unresponsiveEndpoint]);
});
