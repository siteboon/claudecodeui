import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, scanStateDb, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';

for (const failure of ['directory', 'transcript'] as const) {
  test(`Claude retries older profile transcripts after a ${failure} read failure`, {
    skip: process.platform === 'win32' || process.getuid?.() === 0
      ? 'Permission failures require a non-root POSIX user' : false,
  }, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'claude-profile-retry-'));
    const saved = Object.fromEntries(['DATABASE_PATH', 'CLOUDCLI_RUNTIME_PROFILES', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]));
    const profileHome = path.join(root, 'work');
    const projectDirectory = path.join(profileHome, 'projects', 'workspace');
    const transcriptPath = path.join(projectDirectory, 'older-session.jsonl');
    const unreadablePath = failure === 'directory' ? projectDirectory : transcriptPath;
    process.env.DATABASE_PATH = path.join(root, 'auth.db');
    process.env.CLAUDE_CONFIG_DIR = path.join(root, 'default');
    process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify([
      { id: 'work', name: 'Work', provider: 'claude', env: { CLAUDE_CONFIG_DIR: profileHome } },
    ]);
    const synchronizer = new ClaudeSessionSynchronizer();
    const provider = providerRegistry.resolveProvider('claude');
    t.mock.method(providerRegistry, 'listProviders', () => [{ ...provider, sessionSynchronizer: synchronizer }]);

    try {
      await mkdir(projectDirectory, { recursive: true });
      await writeFile(transcriptPath, JSON.stringify({ sessionId: 'older-session', cwd: root }) + '\n');
      closeConnection();
      await initializeDatabase();
      // The transcript predates the cursor but belongs to a newly configured home.
      const previousCursor = new Date('2100-01-01T00:00:00Z');
      scanStateDb.updateLastScannedAt(previousCursor);
      await chmod(unreadablePath, 0);

      const incomplete = await sessionSynchronizerService.synchronizeSessions();
      assert.equal(incomplete.failures.length, 1, 'a partial scan must reach the synchronization service');
      assert.deepEqual(scanStateDb.getLastScannedAt(), previousCursor);
      assert.equal(sessionsDb.getSessionById('older-session'), null);

      await chmod(unreadablePath, failure === 'directory' ? 0o700 : 0o600);
      const retried = await sessionSynchronizerService.synchronizeSessions();
      assert.deepEqual(retried.failures, []);
      assert.equal(retried.processedByProvider.claude, 1);
      assert.equal(sessionsDb.getSessionById('older-session')?.jsonl_path, transcriptPath);
      assert.equal(sessionsDb.getSessionById('older-session')?.runtime_profile_id, 'work');
      assert.notDeepEqual(scanStateDb.getLastScannedAt(), previousCursor);
    } finally {
      await chmod(unreadablePath, failure === 'directory' ? 0o700 : 0o600);
      closeConnection();
      t.mock.restoreAll();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}
