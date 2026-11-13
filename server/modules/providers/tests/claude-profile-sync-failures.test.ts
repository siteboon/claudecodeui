import assert from 'node:assert/strict';
import fsPromises, { appendFile, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, scanStateDb, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';

test('Claude prunes unreadable artifact directories before discovering parent sessions and later homes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'claude-pruned-artifacts-'));
  const saved = Object.fromEntries(['DATABASE_PATH', 'CLOUDCLI_RUNTIME_PROFILES', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]));
  const homes = [path.join(root, 'default'), path.join(root, 'work')];
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  process.env.CLAUDE_CONFIG_DIR = homes[0];
  process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify([
    { id: 'work', name: 'Work', provider: 'claude', env: { CLAUDE_CONFIG_DIR: homes[1] } },
  ]);
  let excludedReads = 0;
  try {
    for (const [index, home] of homes.entries()) {
      const project = path.join(home, 'projects', 'workspace');
      await mkdir(path.join(project, 'parent', 'subagents'), { recursive: true });
      await mkdir(path.join(project, 'parent', 'tool-results'));
      await writeFile(path.join(project, `parent-${index}.jsonl`), JSON.stringify({ sessionId: `parent-${index}`, cwd: root }) + '\n');
    }
    const originalReaddir = fsPromises.readdir;
    t.mock.method(fsPromises, 'readdir', async (...args: Parameters<typeof fsPromises.readdir>) => {
      if (['subagents', 'tool-results'].includes(path.basename(String(args[0])))) {
        excludedReads += 1;
        throw Object.assign(new Error('unreadable excluded artifact directory'), { code: 'EACCES', path: args[0] });
      }
      return originalReaddir(...args);
    });
    syncBuiltinESMExports();
    closeConnection();
    await initializeDatabase();
    const synchronizer = new ClaudeSessionSynchronizer();
    assert.equal(await synchronizer.synchronize(new Date('2100-01-01')), 2);
    assert.equal(excludedReads, 0);
    assert.equal(sessionsDb.getSessionById('parent-0')?.runtime_profile_id, null);
    assert.equal(sessionsDb.getSessionById('parent-1')?.runtime_profile_id, 'work');
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

for (const initiallyComplete of [true, false]) {
  test(initiallyComplete
    ? 'Claude indexes valid profile metadata after malformed JSONL lines'
    : 'Claude retries an incomplete profile transcript after valid metadata is appended', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'claude-profile-jsonl-recovery-'));
    const saved = Object.fromEntries(['DATABASE_PATH', 'CLOUDCLI_RUNTIME_PROFILES', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]));
    const profileHome = path.join(root, 'work');
    const projectDirectory = path.join(profileHome, 'projects', 'workspace');
    const transcriptPath = path.join(projectDirectory, 'older-session.jsonl');
    const validRecords = [
      JSON.stringify({ sessionId: 'older-session', cwd: root }),
      JSON.stringify({ sessionId: 'later-session', cwd: root }),
    ].join('\n') + '\n';
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
      // Valid but unrelated rows and malformed rows must not hide later session metadata.
      await writeFile(transcriptPath, '  \n{"partial":\n{}\n{"broken"\n' + (initiallyComplete ? validRecords : ''));
      closeConnection();
      await initializeDatabase();
      const previousCursor = new Date('2100-01-01T00:00:00Z');
      scanStateDb.updateLastScannedAt(previousCursor);

      // Single-file watcher updates use the reader's default best-effort mode.
      assert.equal(await synchronizer.synchronizeFile(transcriptPath), initiallyComplete ? 'older-session' : null);
      if (!initiallyComplete) {
        const incomplete = await sessionSynchronizerService.synchronizeSessions();
        assert.equal(incomplete.failures.length, 1);
        assert.deepEqual(scanStateDb.getLastScannedAt(), previousCursor);
        assert.equal(sessionsDb.getSessionById('older-session'), null);
        await appendFile(transcriptPath, validRecords);
      }

      // Full scans use strict reads and must recover files older than the cursor.
      const recovered = await sessionSynchronizerService.synchronizeSessions();
      assert.deepEqual(recovered.failures, []);
      assert.equal(recovered.processedByProvider.claude, 1);
      assert.equal(sessionsDb.getSessionById('older-session')?.jsonl_path, transcriptPath);
      assert.equal(sessionsDb.getSessionById('older-session')?.runtime_profile_id, 'work');
      assert.equal(sessionsDb.getSessionById('later-session'), null, 'the first matching record wins');
      assert.notDeepEqual(scanStateDb.getLastScannedAt(), previousCursor);
    } finally {
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

test('Claude fully scans a profile when its missing projects root appears later', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'claude-profile-late-root-'));
  const saved = Object.fromEntries(['DATABASE_PATH', 'CLOUDCLI_RUNTIME_PROFILES', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]));
  const profileHome = path.join(root, 'work');
  const projectDirectory = path.join(profileHome, 'projects', 'workspace');
  const transcriptPath = path.join(projectDirectory, 'older-session.jsonl');
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'default');
  process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify([
    { id: 'work', name: 'Work', provider: 'claude', env: { CLAUDE_CONFIG_DIR: profileHome } },
  ]);
  const synchronizer = new ClaudeSessionSynchronizer();
  const provider = providerRegistry.resolveProvider('claude');
  t.mock.method(providerRegistry, 'listProviders', () => [{ ...provider, sessionSynchronizer: synchronizer }]);

  try {
    closeConnection();
    await initializeDatabase();
    // Both an absent home and an existing home without projects must remain unscanned.
    assert.deepEqual((await sessionSynchronizerService.synchronizeSessions()).failures, []);
    await mkdir(profileHome);
    assert.deepEqual((await sessionSynchronizerService.synchronizeSessions()).failures, []);

    await mkdir(projectDirectory, { recursive: true });
    await writeFile(transcriptPath, JSON.stringify({ sessionId: 'older-session', cwd: root }) + '\n');
    scanStateDb.updateLastScannedAt(new Date('2100-01-01T00:00:00Z'));

    const recovered = await sessionSynchronizerService.synchronizeSessions();
    assert.deepEqual(recovered.failures, []);
    assert.equal(recovered.processedByProvider.claude, 1);
    assert.equal(sessionsDb.getSessionById('older-session')?.jsonl_path, transcriptPath);
    assert.equal(sessionsDb.getSessionById('older-session')?.runtime_profile_id, 'work');
    // A completed scan still switches the home to incremental discovery.
    assert.equal(await synchronizer.synchronize(new Date('2100-01-01T00:00:00Z')), 0);
  } finally {
    closeConnection();
    t.mock.restoreAll();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

for (const vanishedArtifact of ['file', 'directory'] as const) {
  test(`Claude preserves its cursor when a ${vanishedArtifact} vanishes during discovery`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'claude-profile-vanished-'));
    const saved = Object.fromEntries(['DATABASE_PATH', 'CLOUDCLI_RUNTIME_PROFILES', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]));
    const profileHome = path.join(root, 'work');
    const projectsRoot = path.join(profileHome, 'projects');
    const projectDirectory = path.join(projectsRoot, 'workspace');
    const vanishedPath = vanishedArtifact === 'file'
      ? path.join(projectDirectory, 'a-vanished.jsonl') : path.join(projectsRoot, 'a-vanished');
    const survivorPath = path.join(projectDirectory, 'z-survivor.jsonl');
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
      closeConnection();
      await initializeDatabase();
      assert.deepEqual((await sessionSynchronizerService.synchronizeSessions()).failures, []);
      await writeFile(survivorPath, JSON.stringify({ sessionId: 'survivor', cwd: root }) + '\n');
      const previousCursor = new Date('2000-01-01T00:00:00Z');
      scanStateDb.updateLastScannedAt(previousCursor);

      // Remove an entry after it has been listed, producing a real ENOENT in the scan.
      if (vanishedArtifact === 'file') {
        await writeFile(vanishedPath, '{}\n');
        const originalStat = fsPromises.stat;
        t.mock.method(fsPromises, 'stat', async (...args: Parameters<typeof fsPromises.stat>) => {
          if (args[0] === vanishedPath) await rm(vanishedPath);
          return originalStat(...args);
        });
      } else {
        await mkdir(vanishedPath);
        const originalReaddir = fsPromises.readdir;
        t.mock.method(fsPromises, 'readdir', async (...args: Parameters<typeof fsPromises.readdir>) => {
          if (args[0] === vanishedPath) await rm(vanishedPath, { recursive: true });
          return originalReaddir(...args);
        });
      }
      syncBuiltinESMExports();

      const incomplete = await sessionSynchronizerService.synchronizeSessions();
      assert.equal(incomplete.failures.length, 1);
      assert.deepEqual(scanStateDb.getLastScannedAt(), previousCursor);
      t.mock.restoreAll();
      syncBuiltinESMExports();
      t.mock.method(providerRegistry, 'listProviders', () => [{ ...provider, sessionSynchronizer: synchronizer }]);

      const retried = await sessionSynchronizerService.synchronizeSessions();
      assert.deepEqual(retried.failures, []);
      assert.equal(retried.processedByProvider.claude, 1);
      assert.equal(sessionsDb.getSessionById('survivor')?.jsonl_path, survivorPath);
      assert.equal(sessionsDb.getSessionById('survivor')?.runtime_profile_id, 'work');
      assert.notDeepEqual(scanStateDb.getLastScannedAt(), previousCursor);
    } finally {
      closeConnection();
      t.mock.restoreAll();
      syncBuiltinESMExports();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}
