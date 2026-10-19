import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  notificationPreferencesDb,
} from '@/modules/database/index.js';

/**
 * The chime volume is stored with the rest of the notification preferences, so
 * it follows the user between devices the way the sound on/off switch does.
 * Rows written before the setting existed must read back at the default rather
 * than at 0 (silence) or anything louder.
 */

const USER_ID = 1;

async function withDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'notification-prefs-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  getConnection()
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(USER_ID, 'tester', 'hash');

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('a new user starts at the default chime volume', async () => {
  await withDatabase(() => {
    assert.equal(notificationPreferencesDb.getPreferences(USER_ID).soundVolume, 70);
  });
});

test('preferences saved before the volume setting existed read back at the default volume', async () => {
  await withDatabase(() => {
    getConnection()
      .prepare('INSERT INTO user_notification_preferences (user_id, preferences_json) VALUES (?, ?)')
      .run(USER_ID, JSON.stringify({
        channels: { inApp: false, webPush: false, desktop: false, sound: false },
        events: { actionRequired: true, stop: true, error: true },
      }));

    const preferences = notificationPreferencesDb.getPreferences(USER_ID);
    assert.equal(preferences.soundVolume, 70);
    assert.equal(preferences.channels.sound, false, 'the on/off switch is untouched');
  });
});

test('a saved volume round-trips and survives a channel toggle', async () => {
  await withDatabase(() => {
    const current = notificationPreferencesDb.getPreferences(USER_ID);
    notificationPreferencesDb.updatePreferences(USER_ID, { ...current, soundVolume: 35 });
    assert.equal(notificationPreferencesDb.getPreferences(USER_ID).soundVolume, 35);

    // The push and desktop endpoints rewrite the preferences by spreading the
    // stored ones; the volume must come through that unchanged.
    const stored = notificationPreferencesDb.getPreferences(USER_ID);
    notificationPreferencesDb.updatePreferences(USER_ID, {
      ...stored,
      channels: { ...stored.channels, webPush: true },
    });
    assert.equal(notificationPreferencesDb.getPreferences(USER_ID).soundVolume, 35);
  });
});

test('a submitted volume is clamped to a whole percent between 0 and 100', async () => {
  await withDatabase(() => {
    const save = (soundVolume: unknown) => notificationPreferencesDb.updatePreferences(USER_ID, { soundVolume }).soundVolume;
    assert.equal(save(0), 0);
    assert.equal(save(100), 100);
    assert.equal(save(150), 100);
    assert.equal(save(-20), 0);
    assert.equal(save(42.6), 43);
    assert.equal(save('80'), 70);
    assert.equal(save(Number.NaN), 70);
    assert.equal(save(null), 70);
  });
});
