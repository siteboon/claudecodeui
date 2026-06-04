/**
 * Notification preferences repository.
 *
 * Stores per-user notification channel/event preferences as JSON.
 */

import { getConnection } from '@/modules/database/connection.js';

type NotificationPreferences = {
  channels: {
    inApp: boolean;
    webPush: boolean;
  };
  events: {
    actionRequired: boolean;
    stop: boolean;
    error: boolean;
  };
};

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: {
    inApp: false,
    webPush: false,
  },
  events: {
    actionRequired: true,
    stop: true,
    error: true,
  },
};

function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const source = value && typeof value === 'object' ? (value as Record<string, any>) : {};

  return {
    channels: {
      inApp: source.channels?.inApp === true,
      webPush: source.channels?.webPush === true,
    },
    events: {
      actionRequired: source.events?.actionRequired !== false,
      stop: source.events?.stop !== false,
      error: source.events?.error !== false,
    },
  };
}

export const notificationPreferencesDb = {
  /** Returns the normalized preferences for a user, creating defaults on first read. */
  getNotificationPreferences(userId: number): NotificationPreferences {
    const db = getConnection();
    const row = db
      .prepare(
        'SELECT preferences_json FROM user_notification_preferences WHERE user_id = ?'
      )
      .get(userId) as { preferences_json: string } | undefined;

    if (!row) {
      const defaults = normalizeNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      db.prepare(
        'INSERT INTO user_notification_preferences (user_id, preferences_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      ).run(userId, JSON.stringify(defaults));
      return defaults;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.preferences_json);
    } catch {
      parsed = DEFAULT_NOTIFICATION_PREFERENCES;
    }
    return normalizeNotificationPreferences(parsed);
  },

  /** Upserts normalized preferences for a user and returns the stored value. */
  updateNotificationPreferences(
    userId: number,
    preferences: unknown
  ): NotificationPreferences {
    const normalized = normalizeNotificationPreferences(preferences);
    const db = getConnection();

    db.prepare(
      `INSERT INTO user_notification_preferences (user_id, preferences_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         preferences_json = excluded.preferences_json,
         updated_at = CURRENT_TIMESTAMP`
    ).run(userId, JSON.stringify(normalized));

    return normalized;
  },

  // Legacy aliases used by existing services/routes
  getPreferences(userId: number): NotificationPreferences {
    return notificationPreferencesDb.getNotificationPreferences(userId);
  },
  updatePreferences(userId: number, preferences: unknown): NotificationPreferences {
    return notificationPreferencesDb.updateNotificationPreferences(userId, preferences);
  },
};

