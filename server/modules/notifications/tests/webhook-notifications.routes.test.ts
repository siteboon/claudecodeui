import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { closeConnection, initializeDatabase, notificationChannelEndpointsDb, userDb } from '@/modules/database/index.js';
import notificationRoutes from '@/modules/notifications/notifications.routes.js';
import { webhookNotificationsService } from '@/modules/notifications/services/webhook-notifications.service.js';
import { AppError } from '@/shared/utils.js';

type Call = (method: string, url: string, body?: unknown) => Promise<{ status: number; raw: string; json: any }>;

/**
 * Mounts the real notifications router the way server/index.ts does (auth
 * replaced by a fixed user, the same AppError envelope), on a fresh database.
 */
async function withNotificationsApi(runTest: (call: Call, userId: number) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'webhook-routes-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  await initializeDatabase();
  const userId = Number(userDb.createUser('routes-user', 'x').id);

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: { id: number } }).user = { id: userId };
    next();
  });
  app.use('/api/notifications', notificationRoutes);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call: Call = async (method, url, body) => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    return { status: response.status, raw, json: JSON.parse(raw) };
  };

  try {
    await runTest(call, userId);
  } finally {
    await webhookNotificationsService.waitForIdle();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('webhook routes: configure, validate, generate a secret once, test, remove', async () => {
  const hits: string[] = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { hits.push(body); res.end('ok'); });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  try {
    await withNotificationsApi(async (call) => {
      const empty = await call('GET', '/api/notifications/webhook');
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.json.data.webhook, {
        configured: false, enabled: false, url: '', allowHttp: false, hasSecret: false, lastDelivery: null,
      });

      const insecure = await call('PUT', '/api/notifications/webhook', { url: receiverUrl });
      assert.equal(insecure.status, 400);
      assert.equal(insecure.json.error.code, 'WEBHOOK_URL_INSECURE');

      const blocked = await call('PUT', '/api/notifications/webhook', { url: 'http://169.254.169.254/', allowHttp: true });
      assert.equal(blocked.status, 400);
      assert.equal(blocked.json.error.code, 'WEBHOOK_URL_BLOCKED');

      const badFlag = await call('PUT', '/api/notifications/webhook', { url: receiverUrl, allowHttp: 'yes' });
      assert.equal(badFlag.status, 400);
      assert.equal(badFlag.json.error.code, 'INVALID_REQUEST_BODY');

      const missingUrl = await call('PUT', '/api/notifications/webhook', { allowHttp: true });
      assert.equal(missingUrl.status, 400);

      const saved = await call('PUT', '/api/notifications/webhook', { url: receiverUrl, allowHttp: true });
      assert.equal(saved.status, 200);
      assert.deepEqual(
        { configured: saved.json.data.webhook.configured, enabled: saved.json.data.webhook.enabled, url: saved.json.data.webhook.url },
        { configured: true, enabled: true, url: receiverUrl },
      );

      const created = await call('POST', '/api/notifications/webhook/secret');
      assert.equal(created.status, 200);
      const secret: string = created.json.data.secret;
      assert.match(secret, /^whsec_/);
      assert.equal(created.json.data.webhook.hasSecret, true);

      // From here on the secret is never returned again, by either route family.
      const reread = await call('GET', '/api/notifications/webhook');
      assert.equal(reread.json.data.webhook.hasSecret, true);
      assert.ok(!reread.raw.includes(secret.slice(6)));
      const generic = await call('GET', '/api/notifications/endpoints?channel=webhook');
      assert.equal(generic.status, 200);
      assert.equal(generic.json.endpoints.length, 1);
      assert.equal(generic.json.endpoints[0].metadata.url, receiverUrl);
      assert.equal('secret' in generic.json.endpoints[0].metadata, false);
      assert.ok(!generic.raw.includes(secret.slice(6)));

      const tested = await call('POST', '/api/notifications/webhook/test');
      assert.equal(tested.status, 200);
      assert.equal(tested.json.data.delivery.ok, true);
      assert.equal(tested.json.data.delivery.status, 200);
      assert.equal(tested.json.data.webhook.lastDelivery.eventId, tested.json.data.delivery.eventId);
      assert.equal(JSON.parse(hits[0]).type, 'webhook.test');

      const disabled = await call('PUT', '/api/notifications/webhook', { url: receiverUrl, allowHttp: true, enabled: false });
      assert.equal(disabled.json.data.webhook.enabled, false);
      assert.equal(disabled.json.data.webhook.hasSecret, true);

      const removedSecret = await call('DELETE', '/api/notifications/webhook/secret');
      assert.equal(removedSecret.json.data.webhook.hasSecret, false);

      const removed = await call('DELETE', '/api/notifications/webhook');
      assert.equal(removed.json.data.removed, true);
      const gone = await call('GET', '/api/notifications/webhook');
      assert.equal(gone.json.data.webhook.configured, false);

      const noSecretWithoutConfig = await call('POST', '/api/notifications/webhook/secret');
      assert.equal(noSecretWithoutConfig.status, 404);
      assert.equal(noSecretWithoutConfig.json.error.code, 'WEBHOOK_NOT_CONFIGURED');
    });
  } finally {
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});

test('the generic endpoint routes refuse the webhook channel but still serve the others', async () => {
  await withNotificationsApi(async (call, userId) => {
    await call('PUT', '/api/notifications/webhook', { url: 'https://hooks.example.com/cloudcli' });

    // Would bypass URL validation and write a secret the user never generated.
    const bypass = await call('POST', '/api/notifications/endpoints/current', {
      channel: ' webhook ',
      endpointId: 'default',
      metadata: { url: 'http://169.254.169.254/', allowHttp: true, secret: 'whsec_attacker' },
    });
    assert.equal(bypass.status, 400);
    const patch = await call('PATCH', '/api/notifications/endpoints/webhook/default', { enabled: false });
    assert.equal(patch.status, 400);
    const remove = await call('DELETE', '/api/notifications/endpoints/webhook/default');
    assert.equal(remove.status, 400);

    const row = notificationChannelEndpointsDb.getEndpoint(userId, 'webhook', 'default');
    assert.equal(row?.enabled, 1);
    assert.deepEqual(notificationChannelEndpointsDb.parseMetadata(row?.metadata_json ?? null), {
      url: 'https://hooks.example.com/cloudcli',
      allowHttp: false,
    });

    // The desktop app keeps registering through the generic routes.
    const desktop = await call('POST', '/api/notifications/endpoints/current', {
      channel: 'desktop',
      endpointId: 'device-1',
      metadata: { platform: 'linux' },
    });
    assert.equal(desktop.status, 200);
    assert.equal(desktop.json.preferences.channels.desktop, true);
    const desktopOff = await call('PATCH', '/api/notifications/endpoints/desktop/device-1', { enabled: false });
    assert.equal(desktopOff.status, 200);
    const desktopGone = await call('DELETE', '/api/notifications/endpoints/desktop/device-1');
    assert.equal(desktopGone.status, 200);
  });
});
