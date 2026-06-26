import { getConnection } from '@/modules/database/connection.js';

type NotificationChannelEndpointRow = {
  id: number;
  user_id: number;
  channel: string;
  endpoint_id: string;
  label: string | null;
  metadata_json: string | null;
  enabled: number;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

type UpsertNotificationChannelEndpointInput = {
  userId: number;
  channel: string;
  endpointId: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
  enabled?: boolean;
};

function normalizeRequiredText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function serializeMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  return JSON.stringify(metadata);
}

function parseMetadata(metadataJson: string | null): Record<string, unknown> {
  if (!metadataJson) return {};
  try {
    const parsed = JSON.parse(metadataJson);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export const notificationChannelEndpointsDb = {
  upsertEndpoint(input: UpsertNotificationChannelEndpointInput): NotificationChannelEndpointRow {
    const channel = normalizeRequiredText(input.channel);
    const endpointId = normalizeRequiredText(input.endpointId);
    if (!channel) throw new Error('channel is required');
    if (!endpointId) throw new Error('endpointId is required');

    const enabled = input.enabled === false ? 0 : 1;
    const db = getConnection();
    db.prepare(
      `INSERT INTO notification_channel_endpoints (
         user_id,
         channel,
         endpoint_id,
         label,
         metadata_json,
         enabled,
         last_seen_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, channel, endpoint_id) DO UPDATE SET
         label = excluded.label,
         metadata_json = excluded.metadata_json,
         enabled = excluded.enabled,
         last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`
    ).run(
      input.userId,
      channel,
      endpointId,
      normalizeNullableText(input.label),
      serializeMetadata(input.metadata),
      enabled
    );

    return notificationChannelEndpointsDb.getEndpoint(input.userId, channel, endpointId)!;
  },

  getEndpoint(userId: number, channel: string, endpointId: string): NotificationChannelEndpointRow | null {
    const db = getConnection();
    const row = db.prepare(
      `SELECT id, user_id, channel, endpoint_id, label, metadata_json, enabled, last_seen_at, created_at, updated_at
       FROM notification_channel_endpoints
       WHERE user_id = ? AND channel = ? AND endpoint_id = ?`
    ).get(
      userId,
      normalizeRequiredText(channel),
      normalizeRequiredText(endpointId)
    ) as NotificationChannelEndpointRow | undefined;
    return row || null;
  },

  getEndpoints(userId: number, channel: string): NotificationChannelEndpointRow[] {
    const db = getConnection();
    return db.prepare(
      `SELECT id, user_id, channel, endpoint_id, label, metadata_json, enabled, last_seen_at, created_at, updated_at
       FROM notification_channel_endpoints
       WHERE user_id = ? AND channel = ?
       ORDER BY last_seen_at DESC`
    ).all(userId, normalizeRequiredText(channel)) as NotificationChannelEndpointRow[];
  },

  getEnabledEndpoints(userId: number, channel: string): NotificationChannelEndpointRow[] {
    const db = getConnection();
    return db.prepare(
      `SELECT id, user_id, channel, endpoint_id, label, metadata_json, enabled, last_seen_at, created_at, updated_at
       FROM notification_channel_endpoints
       WHERE user_id = ? AND channel = ? AND enabled = 1
       ORDER BY last_seen_at DESC`
    ).all(userId, normalizeRequiredText(channel)) as NotificationChannelEndpointRow[];
  },

  setEndpointEnabled(userId: number, channel: string, endpointId: string, enabled: boolean): boolean {
    const db = getConnection();
    const result = db.prepare(
      `UPDATE notification_channel_endpoints
       SET enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND channel = ? AND endpoint_id = ?`
    ).run(enabled ? 1 : 0, userId, normalizeRequiredText(channel), normalizeRequiredText(endpointId));
    return result.changes > 0;
  },

  touchEndpoint(userId: number, channel: string, endpointId: string): boolean {
    const db = getConnection();
    const result = db.prepare(
      `UPDATE notification_channel_endpoints
       SET last_seen_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND channel = ? AND endpoint_id = ?`
    ).run(userId, normalizeRequiredText(channel), normalizeRequiredText(endpointId));
    return result.changes > 0;
  },

  removeEndpoint(userId: number, channel: string, endpointId: string): boolean {
    const db = getConnection();
    const result = db.prepare(
      'DELETE FROM notification_channel_endpoints WHERE user_id = ? AND channel = ? AND endpoint_id = ?'
    ).run(userId, normalizeRequiredText(channel), normalizeRequiredText(endpointId));
    return result.changes > 0;
  },

  parseMetadata,
};
