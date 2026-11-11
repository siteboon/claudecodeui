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
    desktop: boolean;
    sound: boolean;
    [key: string]: boolean;
  };
  events: {
    actionRequired: boolean;
    stop: boolean;
    error: boolean;
  };
  /** Completion chime volume in percent (0-100); the `sound` channel still decides whether it plays. */
  soundVolume: number;
};

/**
 * Chime volume for users who never moved the slider, including every row saved
 * before the setting existed. Mirrors DEFAULT_NOTIFICATION_SOUND_VOLUME in src/shared/constants.ts.
 */
const DEFAULT_SOUND_VOLUME = 70;

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: {
    inApp: false,
    webPush: false,
    desktop: false,
    sound: true,
  },
  events: {
    actionRequired: true,
    stop: true,
    error: true,
  },
  soundVolume: DEFAULT_SOUND_VOLUME,
};

/** Clamps a stored or submitted volume to a whole percent; anything that is not a number means the default. */
function normalizeSoundVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SOUND_VOLUME;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const source = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const sourceChannels = source.channels && typeof source.channels === 'object'
    ? source.channels as Record<string, unknown>
    : {};
  const extraChannels = Object.fromEntries(
    Object.entries(sourceChannels)
      .filter(([key, channelValue]) => !['inApp', 'webPush', 'desktop', 'sound'].includes(key) && typeof channelValue === 'boolean')
  ) as Record<string, boolean>;

  return {
    channels: {
      ...extraChannels,
      inApp: source.channels?.inApp === true,
      webPush: source.channels?.webPush === true,
      desktop: source.channels?.desktop === true,
      sound: source.channels?.sound !== false,
    },
    events: {
      actionRequired: source.events?.actionRequired !== false,
      stop: source.events?.stop !== false,
      error: source.events?.error !== false,
    },
    soundVolume: normalizeSoundVolume(source.soundVolume),
  };
}

/** Reads a user's stored preferences, or null when the user has no row yet. */
function readStoredPreferences(userId: number): NotificationPreferences | null {
  const row = getConnection()
    .prepare(
      'SELECT preferences_json FROM user_notification_preferences WHERE user_id = ?'
    )
    .get(userId) as { preferences_json: string } | undefined;
  if (!row) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.preferences_json);
  } catch {
    parsed = DEFAULT_NOTIFICATION_PREFERENCES;
  }
  return normalizeNotificationPreferences(parsed);
}

export const notificationPreferencesDb = {
  /** Returns the normalized preferences for a user, creating defaults on first read. */
  getNotificationPreferences(userId: number): NotificationPreferences {
    const stored = readStoredPreferences(userId);
    if (stored) {
      return stored;
    }

    const defaults = normalizeNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
    getConnection().prepare(
      'INSERT INTO user_notification_preferences (user_id, preferences_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run(userId, JSON.stringify(defaults));
    return defaults;
  },

  /**
   * Upserts normalized preferences for a user and returns the stored value.
   * A payload without `soundVolume` keeps the stored volume: a tab still running
   * a bundle from before the setting existed, or a script that only sends
   * channels and events, must not reset it to the default.
   */
  updateNotificationPreferences(
    userId: number,
    preferences: unknown
  ): NotificationPreferences {
    const source = preferences && typeof preferences === 'object'
      ? preferences as Record<string, unknown>
      : {};
    const normalized = normalizeNotificationPreferences(
      source.soundVolume === undefined
        ? { ...source, soundVolume: readStoredPreferences(userId)?.soundVolume }
        : source
    );
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
