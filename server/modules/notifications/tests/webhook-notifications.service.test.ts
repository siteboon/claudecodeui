import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type dns from 'node:dns';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { format } from 'node:util';

import {
  closeConnection,
  initializeDatabase,
  notificationChannelEndpointsDb,
  notificationPreferencesDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import {
  createNotificationEvent as createNotificationEventJs,
  notifyBackgroundWorkCompleted as notifyBackgroundWorkCompletedJs,
  notifyRunFailed as notifyRunFailedJs,
  notifyRunStopped as notifyRunStoppedJs,
  notifyUserIfEnabled,
} from '@/modules/notifications/index.js';
import {
  createWebhookNotificationsService,
  webhookNotificationsService,
} from '@/modules/notifications/services/webhook-notifications.service.js';
import { AppError } from '@/shared/utils.js';

// The orchestrator is JavaScript, and TypeScript reads its `sessionId = null`
// defaults as null-only parameters; these loosely typed views take real ids.
type OrchestratorInput = Record<string, unknown>;
const notifyRunStopped = notifyRunStoppedJs as unknown as (input: OrchestratorInput) => void;
const notifyRunFailed = notifyRunFailedJs as unknown as (input: OrchestratorInput) => void;
const notifyBackgroundWorkCompleted = notifyBackgroundWorkCompletedJs as unknown as (input: OrchestratorInput) => void;
const createNotificationEvent = createNotificationEventJs as unknown as (
  input: OrchestratorInput,
) => ReturnType<typeof createNotificationEventJs>;

type ReceivedRequest = { headers: http.IncomingHttpHeaders; body: string; url: string };
type Receiver = { url: string; hits: ReceivedRequest[]; close: () => Promise<void> };

const PAYLOAD_KEYS = ['createdAt', 'id', 'outcome', 'provider', 'sessionId', 'test', 'type', 'version'];
const FAST = { attemptTimeoutMs: 300, retryDelaysMs: [20, 20] };

let unhandledRejections = 0;
process.on('unhandledRejection', () => {
  unhandledRejections += 1;
});

async function startReceiver(
  respond: (request: http.IncomingMessage, response: http.ServerResponse, hitIndex: number) => void = (_req, res) => res.end('ok'),
): Promise<Receiver> {
  const hits: ReceivedRequest[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      hits.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8'), url: request.url || '' });
      respond(request, response, hits.length - 1);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

async function withDatabase(runTest: (userId: number) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'webhook-notifications-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest(Number(userDb.createUser('webhook-user', 'x').id));
  } finally {
    await webhookNotificationsService.waitForIdle();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** Independent Standard Webhooks v1 signer, checked against the spec's published vector below. */
function standardWebhookSignature(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

function assertAppErrorCode(run: () => unknown, code: string): void {
  assert.throws(run, (error: unknown) => error instanceof AppError && error.code === code && error.statusCode === 400);
}

async function waitForHits(receiver: Receiver, count: number, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (receiver.hits.length < count) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`receiver got ${receiver.hits.length} of ${count} requests`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('the test signer reproduces the Standard Webhooks published example', () => {
  assert.equal(
    standardWebhookSignature('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'msg_p5jXN8AQM9LWM0D4loKWxJek', '1614265330', '{"test": 2432232314}'),
    'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
  );
});

test('no webhook row, or a disabled one, sends nothing for run events', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver();
    try {
      notifyRunStopped({ userId, provider: 'claude', sessionId: 'off-1', stopReason: 'completed' });
      notifyRunFailed({ userId, provider: 'codex', sessionId: 'off-1', error: new Error('boom') });

      webhookNotificationsService.saveConfig(userId, { url: `${receiver.url}/hook`, allowHttp: true, enabled: false });
      notifyRunStopped({ userId, provider: 'claude', sessionId: 'off-2', stopReason: 'completed' });
      notifyRunFailed({ userId, provider: 'codex', sessionId: 'off-2', error: new Error('boom') });

      await webhookNotificationsService.waitForIdle();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(receiver.hits.length, 0);
    } finally {
      await receiver.close();
    }
  });
});

test('enabled: each lifecycle event becomes one minimal, versioned event carrying the app session id', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver();
    try {
      sessionsDb.createAppSession('app-session-1', 'claude', '/workspace/demo');
      sessionsDb.assignProviderSessionId('app-session-1', 'claude-native-1');
      webhookNotificationsService.saveConfig(userId, { url: `${receiver.url}/hook?token=abc`, allowHttp: true });

      notifyRunStopped({ userId, provider: 'claude', sessionId: 'claude-native-1', stopReason: 'completed', sessionName: 'secret prompt words' });
      notifyRunStopped({ userId, provider: 'cursor', sessionId: 'cursor-1', stopReason: 'aborted' });
      notifyRunFailed({ userId, provider: 'codex', sessionId: 'codex-1', error: new Error('rm -rf output with API_KEY=sk-live') });
      notifyBackgroundWorkCompleted({ userId, provider: 'claude', sessionId: 'claude-bg-1' });
      // Not run lifecycle: never sent.
      notifyUserIfEnabled({
        userId,
        event: createNotificationEvent({ provider: 'claude', sessionId: 'x', kind: 'action_required', code: 'permission.required', meta: { toolName: 'Bash' } }),
      });
      notifyUserIfEnabled({
        userId,
        event: createNotificationEvent({ provider: 'claude', sessionId: 'x', kind: 'info', code: 'agent.notification', meta: { message: 'model text' } }),
      });

      await waitForHits(receiver, 4);
      await webhookNotificationsService.waitForIdle();
      assert.equal(receiver.hits.length, 4);

      const bodies = receiver.hits.map((hit) => JSON.parse(hit.body));
      const byType = Object.fromEntries(bodies.map((body) => [body.type, body]));
      assert.deepEqual(Object.keys(byType).sort(), ['run.background_completed', 'run.cancelled', 'run.completed', 'run.failed']);
      for (const body of bodies) {
        assert.deepEqual(Object.keys(body).sort(), PAYLOAD_KEYS);
        assert.equal(body.version, 1);
        assert.match(body.id, /^evt_[0-9a-f-]{36}$/);
        assert.equal(body.test, false);
        assert.ok(!Number.isNaN(Date.parse(body.createdAt)));
      }
      assert.deepEqual(
        { provider: byType['run.completed'].provider, sessionId: byType['run.completed'].sessionId, outcome: byType['run.completed'].outcome },
        { provider: 'claude', sessionId: 'app-session-1', outcome: 'completed' },
      );
      assert.equal(byType['run.cancelled'].outcome, 'cancelled');
      assert.equal(byType['run.cancelled'].provider, 'cursor');
      assert.equal(byType['run.failed'].outcome, 'failed');
      assert.equal(byType['run.background_completed'].outcome, 'completed');

      const everything = receiver.hits.map((hit) => hit.body).join('\n');
      assert.doesNotMatch(everything, /secret prompt words|rm -rf|sk-live|model text|Bash/);
      for (const hit of receiver.hits) {
        assert.equal(hit.url, '/hook?token=abc');
        assert.equal(hit.headers['content-type'], 'application/json');
        assert.equal(hit.headers['user-agent'], 'CloudCLI-Webhooks/1');
        assert.equal(hit.headers['webhook-id'], JSON.parse(hit.body).id);
        assert.match(String(hit.headers['webhook-timestamp']), /^\d{10}$/);
        // No secret configured: no signature header.
        assert.equal(hit.headers['webhook-signature'], undefined);
      }

      const status = webhookNotificationsService.getConfig(userId).lastDelivery;
      assert.equal(status?.ok, true);
      assert.equal(status?.status, 200);
      assert.equal(status?.attempts, 1);
    } finally {
      await receiver.close();
    }
  });
});

test('the existing event checkboxes gate webhooks: stop covers completed/cancelled, error covers failed', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver();
    try {
      webhookNotificationsService.saveConfig(userId, { url: receiver.url, allowHttp: true });

      notificationPreferencesDb.updatePreferences(userId, { events: { actionRequired: true, stop: false, error: true } });
      notifyRunStopped({ userId, provider: 'claude', sessionId: 'pref-1', stopReason: 'completed' });
      notifyRunStopped({ userId, provider: 'claude', sessionId: 'pref-1', stopReason: 'aborted' });
      notifyBackgroundWorkCompleted({ userId, provider: 'claude', sessionId: 'pref-1' });
      notifyRunFailed({ userId, provider: 'claude', sessionId: 'pref-1', error: 'boom' });
      await waitForHits(receiver, 1);
      await webhookNotificationsService.waitForIdle();
      assert.deepEqual(receiver.hits.map((hit) => JSON.parse(hit.body).type), ['run.failed']);

      notificationPreferencesDb.updatePreferences(userId, { events: { actionRequired: true, stop: true, error: false } });
      notifyRunFailed({ userId, provider: 'claude', sessionId: 'pref-2', error: 'boom' });
      notifyRunStopped({ userId, provider: 'claude', sessionId: 'pref-2', stopReason: 'completed' });
      await waitForHits(receiver, 2);
      await webhookNotificationsService.waitForIdle();
      assert.deepEqual(receiver.hits.map((hit) => JSON.parse(hit.body).type), ['run.failed', 'run.completed']);
    } finally {
      await receiver.close();
    }
  });
});

test('retries keep the event id and body, and every attempt carries a valid signature', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver((_req, res, index) => {
      res.statusCode = index < 2 ? 500 : 200;
      res.end();
    });
    try {
      const notifier = createWebhookNotificationsService(FAST);
      notifier.saveConfig(userId, { url: receiver.url, allowHttp: true });
      const { secret } = notifier.createSecret(userId);
      assert.match(secret, /^whsec_[A-Za-z0-9+/]{43}=$/);

      const delivery = await notifier.sendForEvent({
        userId,
        event: createNotificationEvent({ provider: 'codex', sessionId: 'retry-1', kind: 'stop', code: 'run.stopped', meta: { stopReason: 'completed' } }),
      });

      assert.equal(receiver.hits.length, 3);
      assert.deepEqual({ ok: delivery?.ok, status: delivery?.status, attempts: delivery?.attempts }, { ok: true, status: 200, attempts: 3 });
      const [first] = receiver.hits;
      for (const hit of receiver.hits) {
        assert.equal(hit.body, first.body);
        assert.equal(hit.headers['webhook-id'], first.headers['webhook-id']);
        assert.equal(JSON.parse(hit.body).id, first.headers['webhook-id']);
        assert.equal(
          hit.headers['webhook-signature'],
          standardWebhookSignature(secret, String(hit.headers['webhook-id']), String(hit.headers['webhook-timestamp']), hit.body),
        );
      }
    } finally {
      await receiver.close();
    }
  });
});

test('4xx other than 408/429 is not retried; 429 is', async () => {
  await withDatabase(async (userId) => {
    let status = 400;
    const receiver = await startReceiver((_req, res) => {
      res.statusCode = status;
      res.end();
    });
    try {
      const notifier = createWebhookNotificationsService(FAST);
      notifier.saveConfig(userId, { url: receiver.url, allowHttp: true });
      const event = createNotificationEvent({ provider: 'claude', sessionId: 's', kind: 'error', code: 'run.failed' });

      const rejected = await notifier.sendForEvent({ userId, event });
      assert.deepEqual({ error: rejected?.error, status: rejected?.status, attempts: rejected?.attempts }, { error: 'httpStatus', status: 400, attempts: 1 });

      status = 429;
      const throttled = await notifier.sendForEvent({ userId, event });
      assert.deepEqual({ error: throttled?.error, status: throttled?.status, attempts: throttled?.attempts }, { error: 'httpStatus', status: 429, attempts: 3 });
    } finally {
      await receiver.close();
    }
  });
});

test('a hanging receiver never blocks the caller: notify returns at once, attempts time out, nothing rejects', async () => {
  await withDatabase(async (userId) => {
    // Accepts the request and never answers.
    const receiver = await startReceiver(() => {});
    const rejectionsBefore = unhandledRejections;
    try {
      const notifier = createWebhookNotificationsService({ attemptTimeoutMs: 150, retryDelaysMs: [10, 10] });
      notifier.saveConfig(userId, { url: receiver.url, allowHttp: true });

      const startedAt = performance.now();
      const pending = notifier.sendForEvent({
        userId,
        event: createNotificationEvent({ provider: 'claude', sessionId: 'hang-1', kind: 'stop', code: 'run.stopped' }),
      });
      assert.ok(performance.now() - startedAt < 50, 'sendForEvent must not wait for the receiver');

      const delivery = await pending;
      assert.deepEqual({ ok: delivery?.ok, error: delivery?.error, attempts: delivery?.attempts }, { ok: false, error: 'timeout', attempts: 3 });
      assert.equal(receiver.hits.length, 3);
      assert.equal(notifier.getConfig(userId).lastDelivery?.error, 'timeout');
      assert.equal(unhandledRejections, rejectionsBefore);
    } finally {
      await receiver.close();
    }
  });
});

test('the orchestrator hands a slow delivery off without waiting for it', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver((_req, res) => {
      setTimeout(() => res.end('ok'), 300);
    });
    try {
      webhookNotificationsService.saveConfig(userId, { url: receiver.url, allowHttp: true });
      const startedAt = performance.now();
      notifyRunStopped({ userId, provider: 'claude', sessionId: 'slow-1', stopReason: 'completed' });
      assert.ok(performance.now() - startedAt < 50, 'notifyRunStopped must return before the receiver answers');

      await webhookNotificationsService.waitForIdle();
      assert.ok(performance.now() - startedAt >= 300);
      assert.equal(webhookNotificationsService.getConfig(userId).lastDelivery?.ok, true);
    } finally {
      await receiver.close();
    }
  });
});

test('redirects are not followed', async () => {
  await withDatabase(async (userId) => {
    const target = await startReceiver();
    const redirector = await startReceiver((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${target.url}/elsewhere`);
      res.end();
    });
    try {
      const notifier = createWebhookNotificationsService(FAST);
      notifier.saveConfig(userId, { url: redirector.url, allowHttp: true });
      const delivery = await notifier.sendForEvent({
        userId,
        event: createNotificationEvent({ provider: 'claude', sessionId: 'redirect-1', kind: 'stop', code: 'run.stopped' }),
      });

      assert.deepEqual({ error: delivery?.error, status: delivery?.status, attempts: delivery?.attempts }, { error: 'redirect', status: 302, attempts: 1 });
      assert.equal(redirector.hits.length, 1);
      assert.equal(target.hits.length, 0);
    } finally {
      await redirector.close();
      await target.close();
    }
  });
});

test('URL policy at save time: https by default, http on opt-in, link-local and friends refused', async () => {
  await withDatabase(async (userId) => {
    const notifier = createWebhookNotificationsService(FAST);
    const save = (url: string, allowHttp = false) => () => notifier.saveConfig(userId, { url, allowHttp });

    assertAppErrorCode(save('http://example.com/hook'), 'WEBHOOK_URL_INSECURE');
    assertAppErrorCode(save('ftp://example.com/hook', true), 'WEBHOOK_URL_INVALID');
    assertAppErrorCode(save('file:///etc/passwd', true), 'WEBHOOK_URL_INVALID');
    assertAppErrorCode(save('not a url', true), 'WEBHOOK_URL_INVALID');
    assertAppErrorCode(save(`https://example.com/${'a'.repeat(2048)}`), 'WEBHOOK_URL_INVALID');
    for (const blocked of [
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:169.254.169.254]/',
      'http://2852039166/',
      'http://0251.0376.0251.0376/',
      'http://[fe80::1]/',
      'http://[fd00:ec2::254]/',
      'http://0.0.0.0:8080/',
      'http://[::]/',
      'http://224.0.0.1/',
      'http://255.255.255.255/',
    ]) {
      assertAppErrorCode(save(blocked, true), 'WEBHOOK_URL_BLOCKED');
    }

    // Loopback, LAN, CGNAT/Tailscale and public destinations are allowed.
    for (const allowed of [
      'http://127.0.0.1:5678/webhook',
      'http://[::1]:8123/api/webhook/abc',
      'http://192.168.1.20/hook',
      'http://100.101.102.103/hook',
      'http://localhost:9000/hook',
    ]) {
      assert.equal(notifier.saveConfig(userId, { url: allowed, allowHttp: true }).url, allowed);
    }
    assert.equal(notifier.saveConfig(userId, { url: ' https://hooks.example.com/cloudcli ' }).url, 'https://hooks.example.com/cloudcli');
  });
});

test('URL policy at connect time: a hostname resolving to a blocked address is refused before connecting', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver();
    try {
      const answers: Record<string, dns.LookupAddress[]> = {
        'metadata.example': [{ address: '169.254.169.254', family: 4 }],
        'mixed.example': [{ address: '127.0.0.1', family: 4 }, { address: 'fe80::1', family: 6 }],
        'mapped.example': [{ address: '::ffff:169.254.169.254', family: 6 }],
        'receiver.example': [{ address: '127.0.0.1', family: 4 }],
      };
      const resolveHost = ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
        const entries = answers[hostname] || [];
        if (options.all) {
          callback(null, entries);
        } else {
          callback(null, entries[0].address, entries[0].family);
        }
      }) as unknown as typeof dns.lookup;
      const notifier = createWebhookNotificationsService({ ...FAST, resolveHost });
      const { port } = new URL(receiver.url);
      const event = createNotificationEvent({ provider: 'claude', sessionId: 'dns-1', kind: 'stop', code: 'run.stopped' });

      for (const host of ['metadata.example', 'mixed.example', 'mapped.example']) {
        notifier.saveConfig(userId, { url: `http://${host}:${port}/hook`, allowHttp: true });
        const delivery = await notifier.sendForEvent({ userId, event });
        assert.deepEqual({ host, error: delivery?.error, attempts: delivery?.attempts }, { host, error: 'blockedAddress', attempts: 1 });
      }
      assert.equal(receiver.hits.length, 0);

      // The same injected resolver lets an allowed answer through.
      notifier.saveConfig(userId, { url: `http://receiver.example:${port}/hook`, allowHttp: true });
      const delivered = await notifier.sendForEvent({ userId, event });
      assert.equal(delivered?.ok, true);
      assert.equal(receiver.hits.length, 1);
    } finally {
      await receiver.close();
    }
  });
});

test('URL policy at send time: a stored row that breaks the policy is not sent', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver();
    try {
      // Written behind the service's back, as an older version or a manual edit could.
      notificationChannelEndpointsDb.upsertEndpoint({
        userId,
        channel: 'webhook',
        endpointId: 'default',
        metadata: { url: receiver.url, allowHttp: false },
        enabled: true,
      });
      const notifier = createWebhookNotificationsService(FAST);
      const delivery = await notifier.sendForEvent({
        userId,
        event: createNotificationEvent({ provider: 'claude', sessionId: 'row-1', kind: 'stop', code: 'run.stopped' }),
      });
      assert.deepEqual({ error: delivery?.error, attempts: delivery?.attempts }, { error: 'insecureUrl', attempts: 1 });
      assert.equal(receiver.hits.length, 0);
    } finally {
      await receiver.close();
    }
  });
});

test('the secret is write-only, survives a re-save, and never reaches logs; logs carry the host only', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver((_req, res) => {
      res.statusCode = 503;
      res.end('upstream says: private response body');
    });
    const logged: string[] = [];
    const originals = { log: console.log, warn: console.warn, error: console.error };
    try {
      const notifier = createWebhookNotificationsService(FAST);
      notifier.saveConfig(userId, { url: `${receiver.url}/private/path?token=tok-123`, allowHttp: true });
      const { secret, webhook } = notifier.createSecret(userId);
      assert.equal(webhook.hasSecret, true);
      assert.doesNotMatch(JSON.stringify(notifier.getConfig(userId)), new RegExp(secret.slice(6, 20)));

      // Saving the destination again (e.g. toggling enabled) keeps the secret.
      const edited = notifier.saveConfig(userId, { url: `${receiver.url}/private/path?token=tok-123`, allowHttp: true, enabled: true });
      assert.equal(edited.hasSecret, true);

      for (const level of ['log', 'warn', 'error'] as const) {
        console[level] = (...args: unknown[]) => {
          logged.push(format(...args));
        };
      }
      const delivery = await notifier.sendForEvent({
        userId,
        event: createNotificationEvent({ provider: 'claude', sessionId: 'log-1', kind: 'stop', code: 'run.stopped' }),
      });
      const testResult = await notifier.sendTestEvent(userId);
      Object.assign(console, originals);

      assert.equal(delivery?.error, 'httpStatus');
      assert.equal(testResult.delivery.error, 'httpStatus');
      assert.equal(testResult.delivery.type, 'webhook.test');
      assert.equal(testResult.delivery.attempts, 1);
      const output = logged.join('\n');
      assert.match(output, /webhook delivery failed/);
      assert.match(output, new RegExp(`127\\.0\\.0\\.1:${new URL(receiver.url).port}`));
      for (const forbidden of [secret, secret.slice(6, 20), '/private/path', 'tok-123', 'private response body', '"version"', 'v1,']) {
        assert.ok(!output.includes(forbidden), `log output must not contain ${forbidden}`);
      }

      const removed = notifier.removeSecret(userId);
      assert.equal(removed.hasSecret, false);
      assert.equal(notifier.getConfig(userId).hasSecret, false);
    } finally {
      Object.assign(console, originals);
      await receiver.close();
    }
  });
});

test('the test event is sent while disabled, and secret/test calls need a configured webhook', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver();
    try {
      const notifier = createWebhookNotificationsService(FAST);
      await assert.rejects(notifier.sendTestEvent(userId), (error: unknown) => error instanceof AppError && error.statusCode === 404);
      assert.throws(() => notifier.createSecret(userId), (error: unknown) => error instanceof AppError && error.code === 'WEBHOOK_NOT_CONFIGURED');

      notifier.saveConfig(userId, { url: receiver.url, allowHttp: true, enabled: false });
      const { delivery } = await notifier.sendTestEvent(userId);
      assert.equal(delivery.ok, true);
      const body = JSON.parse(receiver.hits[0].body);
      assert.deepEqual(Object.keys(body).sort(), PAYLOAD_KEYS);
      assert.deepEqual(
        { type: body.type, test: body.test, provider: body.provider, sessionId: body.sessionId, outcome: body.outcome },
        { type: 'webhook.test', test: true, provider: null, sessionId: null, outcome: null },
      );

      assert.equal(notifier.removeConfig(userId), true);
      assert.equal(notifier.getConfig(userId).configured, false);
    } finally {
      await receiver.close();
    }
  });
});

test('more deliveries than the in-flight cap are dropped and recorded, not queued', async () => {
  await withDatabase(async (userId) => {
    const receiver = await startReceiver((_req, res) => {
      setTimeout(() => res.end('ok'), 100);
    });
    try {
      const notifier = createWebhookNotificationsService({ ...FAST, maxInFlight: 2 });
      notifier.saveConfig(userId, { url: receiver.url, allowHttp: true });
      const send = (sessionId: string) => notifier.sendForEvent({
        userId,
        event: createNotificationEvent({ provider: 'claude', sessionId, kind: 'stop', code: 'run.stopped' }),
      });

      const results = await Promise.all([send('cap-1'), send('cap-2'), send('cap-3')]);
      assert.deepEqual(results.map((result) => result?.error ?? null), [null, null, 'dropped']);
      await notifier.waitForIdle();
      assert.equal(receiver.hits.length, 2);
    } finally {
      await receiver.close();
    }
  });
});
