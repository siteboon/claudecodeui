import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  calculateCutoffDate,
  DEFAULT_AUTO_ARCHIVE_SETTINGS,
  sessionsAutoArchiveService,
} from '@/modules/providers/services/sessions-auto-archive.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'sessions-auto-archive-test-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('calculateCutoffDate correctly aligns to local midnight boundary', () => {
  const fixedNow = new Date('2026-09-03T14:30:00.000Z');
  const cutoff1Day = calculateCutoffDate(1, fixedNow);
  const cutoffDate1 = new Date(cutoff1Day);

  // Expect hours, minutes, seconds to be 0 in local time
  assert.equal(cutoffDate1.getHours(), 0);
  assert.equal(cutoffDate1.getMinutes(), 0);
  assert.equal(cutoffDate1.getSeconds(), 0);

  const cutoff3Days = calculateCutoffDate(3, fixedNow);
  const cutoffDate3 = new Date(cutoff3Days);
  // Difference between 1 day cutoff and 3 day cutoff should be 2 whole days
  const diffDays = Math.round((cutoffDate1.getTime() - cutoffDate3.getTime()) / (24 * 60 * 60 * 1000));
  assert.equal(diffDays, 2);
});

test('getSettings returns defaults when not configured', async () => {
  await withIsolatedDatabase(() => {
    const settings = sessionsAutoArchiveService.getSettings();
    assert.deepEqual(settings, DEFAULT_AUTO_ARCHIVE_SETTINGS);
  });
});

test('updateSettings persists changes in app_config and reads them back', async () => {
  await withIsolatedDatabase(() => {
    const updated = sessionsAutoArchiveService.updateSettings({
      enabled: true,
      retentionDays: 7,
    });
    assert.equal(updated.enabled, true);
    assert.equal(updated.retentionDays, 7);

    const reloaded = sessionsAutoArchiveService.getSettings();
    assert.equal(reloaded.enabled, true);
    assert.equal(reloaded.retentionDays, 7);
  });
});

test('runAutoArchive archives old sessions and preserves fresh sessions', async () => {
  await withIsolatedDatabase(async () => {
    const db = getConnection();

    // Insert an old session (2 days ago)
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO sessions (session_id, provider, custom_name, isArchived, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`
    ).run('session-old', 'claude', 'Old Session', twoDaysAgo, twoDaysAgo);

    // Insert a fresh session (now)
    const freshNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO sessions (session_id, provider, custom_name, isArchived, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`
    ).run('session-fresh', 'claude', 'Fresh Session', freshNow, freshNow);

    // Run auto-archive with retentionDays = 1
    sessionsAutoArchiveService.updateSettings({ enabled: true, retentionDays: 1 });
    const result = await sessionsAutoArchiveService.runAutoArchive(1);

    assert.equal(result.archivedCount, 1);

    const oldSession = sessionsDb.getSessionById('session-old');
    assert.equal(oldSession?.isArchived, 1);

    const freshSession = sessionsDb.getSessionById('session-fresh');
    assert.equal(freshSession?.isArchived, 0);
  });
});

test('startScheduler and stopScheduler manage timer lifecycle without throwing', () => {
  sessionsAutoArchiveService.startScheduler(60_000);
  // Second call is a safe no-op
  sessionsAutoArchiveService.startScheduler(60_000);
  sessionsAutoArchiveService.stopScheduler();
});
