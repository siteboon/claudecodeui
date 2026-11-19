import express from 'express';
import type { Request, Response } from 'express';

import { notificationChannelEndpointsDb, notificationPreferencesDb } from '@/modules/database/index.js';
import {
  WEBHOOK_CHANNEL,
  webhookNotificationsService,
} from '@/modules/notifications/services/webhook-notifications.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeEndpoint(endpoint: any) {
  // Signing secrets (webhook channel) are write-only: shown once when
  // generated, never returned again.
  const metadata = notificationChannelEndpointsDb.parseMetadata(endpoint.metadata_json);
  delete metadata.secret;
  return {
    id: endpoint.id,
    channel: endpoint.channel,
    endpointId: endpoint.endpoint_id,
    label: endpoint.label,
    metadata,
    enabled: Boolean(endpoint.enabled),
    lastSeenAt: endpoint.last_seen_at,
    createdAt: endpoint.created_at,
    updatedAt: endpoint.updated_at,
  };
}

function readUserId(req: express.Request): number {
  const userId = Number((req as any).user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Authenticated user is missing');
  }
  return userId;
}

// The webhook channel is configured only through its own routes below, which
// validate the URL and keep the signing secret out of responses.
function isWebhookChannel(channel: unknown): boolean {
  return readText(channel) === WEBHOOK_CHANNEL;
}

const WEBHOOK_CHANNEL_REFUSAL = { error: 'Use /api/notifications/webhook for the webhook channel' };

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new AppError(`${field} must be a boolean.`, { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return value;
}

function updateChannelPreference(userId: number, channel: string): unknown {
  const currentPrefs = notificationPreferencesDb.getPreferences(userId);
  const hasEnabledEndpoint = notificationChannelEndpointsDb.getEnabledEndpoints(userId, channel).length > 0;
  return notificationPreferencesDb.updatePreferences(userId, {
    ...currentPrefs,
    channels: { ...currentPrefs.channels, [channel]: hasEnabledEndpoint },
  });
}

router.get('/endpoints', (req, res) => {
  try {
    const channel = readText(req.query.channel);
    if (!channel) {
      return res.status(400).json({ error: 'channel is required' });
    }

    const userId = readUserId(req);
    const endpoints = notificationChannelEndpointsDb
      .getEndpoints(userId, channel)
      .map(sanitizeEndpoint);
    return res.json({ success: true, endpoints });
  } catch (error) {
    console.error('Error fetching notification endpoints:', error);
    return res.status(500).json({ error: 'Failed to fetch notification endpoints' });
  }
});

router.post('/endpoints/current', (req, res) => {
  try {
    const { channel, endpointId, label, metadata = {}, enabled = true } = req.body || {};
    const normalizedChannel = readText(channel);
    const normalizedEndpointId = readText(endpointId);
    if (!normalizedChannel || !normalizedEndpointId) {
      return res.status(400).json({ error: 'channel and endpointId are required' });
    }
    if (isWebhookChannel(normalizedChannel)) {
      return res.status(400).json(WEBHOOK_CHANNEL_REFUSAL);
    }

    const userId = readUserId(req);
    const endpoint = notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: normalizedChannel,
      endpointId: normalizedEndpointId,
      label,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      enabled: enabled !== false,
    });

    const preferences = updateChannelPreference(userId, normalizedChannel);
    return res.json({ success: true, endpoint: sanitizeEndpoint(endpoint), preferences });
  } catch (error) {
    console.error('Error registering notification endpoint:', error);
    return res.status(500).json({ error: 'Failed to register notification endpoint' });
  }
});

router.patch('/endpoints/:channel/:endpointId', (req, res) => {
  try {
    const { channel, endpointId } = req.params;
    const { enabled } = req.body || {};
    if (isWebhookChannel(channel)) {
      return res.status(400).json(WEBHOOK_CHANNEL_REFUSAL);
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const userId = readUserId(req);
    const updated = notificationChannelEndpointsDb.setEndpointEnabled(userId, channel, endpointId, enabled);
    if (!updated) {
      return res.status(404).json({ error: 'Notification endpoint not found' });
    }

    const endpoint = notificationChannelEndpointsDb.getEndpoint(userId, channel, endpointId);
    const preferences = updateChannelPreference(userId, channel);
    return res.json({ success: true, endpoint: endpoint ? sanitizeEndpoint(endpoint) : null, preferences });
  } catch (error) {
    console.error('Error updating notification endpoint:', error);
    return res.status(500).json({ error: 'Failed to update notification endpoint' });
  }
});

router.delete('/endpoints/:channel/:endpointId', (req, res) => {
  try {
    const { channel, endpointId } = req.params;
    if (isWebhookChannel(channel)) {
      return res.status(400).json(WEBHOOK_CHANNEL_REFUSAL);
    }
    const userId = readUserId(req);
    const removed = notificationChannelEndpointsDb.removeEndpoint(userId, channel, endpointId);
    if (!removed) {
      return res.status(404).json({ error: 'Notification endpoint not found' });
    }

    const preferences = updateChannelPreference(userId, channel);
    return res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error removing notification endpoint:', error);
    return res.status(500).json({ error: 'Failed to remove notification endpoint' });
  }
});

// ---------------------------------------------------------------------------
// Webhook channel (Settings > Notifications > Webhook)
// ---------------------------------------------------------------------------

router.get(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(createApiSuccessResponse({ webhook: webhookNotificationsService.getConfig(readUserId(req)) }));
  }),
);

router.put(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.url !== 'string') {
      throw new AppError('url is required.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
    }
    const webhook = webhookNotificationsService.saveConfig(readUserId(req), {
      url: body.url,
      allowHttp: readOptionalBoolean(body.allowHttp, 'allowHttp'),
      enabled: readOptionalBoolean(body.enabled, 'enabled'),
    });
    res.json(createApiSuccessResponse({ webhook }));
  }),
);

router.delete(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const removed = webhookNotificationsService.removeConfig(readUserId(req));
    res.json(createApiSuccessResponse({ removed }));
  }),
);

router.post(
  '/webhook/secret',
  asyncHandler(async (req: Request, res: Response) => {
    // The only response that ever carries the secret.
    res.json(createApiSuccessResponse(webhookNotificationsService.createSecret(readUserId(req))));
  }),
);

router.delete(
  '/webhook/secret',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(createApiSuccessResponse({ webhook: webhookNotificationsService.removeSecret(readUserId(req)) }));
  }),
);

router.post(
  '/webhook/test',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await webhookNotificationsService.sendTestEvent(readUserId(req))));
  }),
);

export default router;
