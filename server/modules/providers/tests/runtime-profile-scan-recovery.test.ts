import assert from 'node:assert/strict';
import fsPromises, { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, scanStateDb, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';

for (const provider of ['claude', 'codex'] as const) {
  test(`${provider} indexes later valid transcripts while retrying a malformed file in the same home`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'profile-file-recovery-'));
    const homeKey = provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
    const saved = Object.fromEntries(['DATABASE_PATH', 'CLOUDCLI_RUNTIME_PROFILES', homeKey].map((key) => [key, process.env[key]]));
    process.env.DATABASE_PATH = path.join(root, 'auth.db');
    process.env[homeKey] = root;
    delete process.env.CLOUDCLI_RUNTIME_PROFILES;
    const leaf = path.join(root, provider === 'claude' ? 'projects' : 'sessions');
    const metadata = (id: string) => JSON.stringify(provider === 'claude'
      ? { sessionId: id, cwd: root } : { type: 'session_meta', payload: { id, cwd: root } }) + '\n';
    const synchronizer = provider === 'claude' ? new ClaudeSessionSynchronizer() : new CodexSessionSynchronizer();
    const registered = providerRegistry.resolveProvider(provider);
    t.mock.method(providerRegistry, 'listProviders', () => [{ ...registered, sessionSynchronizer: synchronizer }]);
    try {
      await mkdir(leaf);
      await writeFile(path.join(leaf, 'a-broken.jsonl'), '{broken\n');
      await writeFile(path.join(leaf, 'z-healthy.jsonl'), metadata('healthy'));
      closeConnection();
      await initializeDatabase();
      const previousCursor = new Date('2100-01-01');
      scanStateDb.updateLastScannedAt(previousCursor);
      const incomplete = await sessionSynchronizerService.synchronizeSessions();
      assert.equal(incomplete.failures.length, 1);
      assert.deepEqual(scanStateDb.getLastScannedAt(), previousCursor);
      assert.ok(sessionsDb.getSessionById('healthy'));
      await writeFile(path.join(leaf, 'a-broken.jsonl'), metadata('recovered'));
      assert.deepEqual((await sessionSynchronizerService.synchronizeSessions()).failures, []);
      assert.ok(sessionsDb.getSessionById('recovered'));
    } finally {
      t.mock.restoreAll();
      closeConnection();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  test(`${provider} scans later homes despite failures and fully retries failed homes`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'profile-home-recovery-'));
    const homeKey = provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
    const saved = Object.fromEntries(['DATABASE_PATH', 'CLOUDCLI_RUNTIME_PROFILES', homeKey].map((key) => [key, process.env[key]]));
    const homes = ['default', 'broken', 'healthy'].map((name) => path.join(root, name));
    const leaf = provider === 'claude' ? 'projects' : 'sessions';
    process.env.DATABASE_PATH = path.join(root, 'auth.db');
    process.env[homeKey] = homes[0];
    process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify(homes.slice(1).map((home, index) => ({
      id: index === 0 ? 'broken' : 'healthy', name: `Profile ${index}`, provider, env: { [homeKey]: home },
    })));
    const synchronizer = provider === 'claude' ? new ClaudeSessionSynchronizer() : new CodexSessionSynchronizer();
    const registered = providerRegistry.resolveProvider(provider);
    t.mock.method(providerRegistry, 'listProviders', () => [{ ...registered, sessionSynchronizer: synchronizer }]);
    let failReads = true;
    const originalReaddir = fsPromises.readdir;
    try {
      for (const [index, home] of homes.entries()) {
        await mkdir(path.join(home, leaf), { recursive: true });
        const metadata = provider === 'claude'
          ? { sessionId: `session-${index}`, cwd: root }
          : { type: 'session_meta', payload: { id: `session-${index}`, cwd: root } };
        await writeFile(path.join(home, leaf, `session-${index}.jsonl`), JSON.stringify(metadata) + '\n');
      }
      t.mock.method(fsPromises, 'readdir', async (...args: Parameters<typeof fsPromises.readdir>) => {
        if (failReads && homes.slice(0, 2).some((home) => String(args[0]) === path.join(home, leaf))) {
          throw Object.assign(new Error('unreadable profile'), { code: 'EACCES', path: args[0] });
        }
        return originalReaddir(...args);
      });
      syncBuiltinESMExports();
      closeConnection();
      await initializeDatabase();
      const previousCursor = new Date('2100-01-01T00:00:00Z');
      scanStateDb.updateLastScannedAt(previousCursor);
      const incomplete = await sessionSynchronizerService.synchronizeSessions();
      assert.equal(incomplete.failures.length, 1);
      assert.deepEqual(scanStateDb.getLastScannedAt(), previousCursor);
      assert.equal(sessionsDb.getSessionById('session-0'), null);
      assert.equal(sessionsDb.getSessionById('session-1'), null);
      assert.equal(sessionsDb.getSessionById('session-2')?.runtime_profile_id, 'healthy');

      failReads = false;
      const recovered = await sessionSynchronizerService.synchronizeSessions();
      assert.deepEqual(recovered.failures, []);
      assert.equal(sessionsDb.getSessionById('session-0')?.runtime_profile_id, null);
      assert.equal(sessionsDb.getSessionById('session-1')?.runtime_profile_id, 'broken');
      assert.notDeepEqual(scanStateDb.getLastScannedAt(), previousCursor);
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      closeConnection();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('Codex fully scans a home whose missing sessions root appears later', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-late-home-'));
  const saved = Object.fromEntries(['CODEX_HOME', 'CLOUDCLI_RUNTIME_PROFILES', 'DATABASE_PATH'].map((key) => [key, process.env[key]]));
  process.env.CODEX_HOME = root;
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  delete process.env.CLOUDCLI_RUNTIME_PROFILES;
  try {
    closeConnection();
    await initializeDatabase();
    const synchronizer = new CodexSessionSynchronizer();
    const future = new Date('2100-01-01');
    assert.equal(await synchronizer.synchronize(future), 0);
    await mkdir(path.join(root, 'sessions'));
    await writeFile(path.join(root, 'sessions', 'older.jsonl'), JSON.stringify({
      type: 'session_meta', payload: { id: 'older', cwd: root },
    }) + '\n');
    assert.equal(await synchronizer.synchronize(future), 1);
    assert.equal(await synchronizer.synchronize(future), 0);
  } finally {
    closeConnection();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
