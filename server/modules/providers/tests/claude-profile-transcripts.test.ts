import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import chokidar from 'chokidar';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { providerRuntimeProfilesService } from '@/modules/providers/services/provider-runtime-profiles.service.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';
import { closeSessionsWatcher, initializeSessionsWatcher } from '@/modules/providers/services/sessions-watcher.service.js';

test('Claude profile transcripts are indexed with their own history and profile', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'claude-profile-transcripts-'));
  const saved = Object.fromEntries(['DATABASE_PATH', 'CLOUDCLI_RUNTIME_PROFILES', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]));
  const defaultHome = path.join(root, '.claude');
  const profileHome = path.join(root, 'work');
  const workspace = path.join(root, 'workspace');
  const profiles = [
    { id: 'work', name: 'Work', provider: 'claude', env: { CLAUDE_CONFIG_DIR: profileHome } },
    { id: 'alias', name: 'Alias', provider: 'claude', env: { CLAUDE_CONFIG_DIR: profileHome } },
  ];
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify(profiles);
  delete process.env.CLAUDE_CONFIG_DIR;
  t.mock.method(os, 'homedir', () => root);

  const writeTranscript = async (home: string, id: string, suffix = `${id}.jsonl`) => {
    const filePath = path.join(home, 'projects', 'encoded-workspace', suffix);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({
      type: 'user', sessionId: id, cwd: workspace, uuid: `${id}-message`,
      timestamp: '2026-09-24T13:00:00.000Z', message: { role: 'user', content: 'Work question' },
    }) + '\n');
    return filePath;
  };

  try {
    await mkdir(workspace);
    const defaultPath = await writeTranscript(defaultHome, 'default-session');
    const workPath = await writeTranscript(profileHome, 'work-session');
    const aliasPath = await writeTranscript(profileHome, 'alias-session');
    await writeTranscript(profileHome, 'default-selection');
    const externalPath = await writeTranscript(profileHome, 'external-session');
    const subagentPath = await writeTranscript(profileHome, 'work-session', 'work-session/subagents/agent.jsonl');
    await writeFile(path.join(defaultHome, 'history.jsonl'), JSON.stringify({ sessionId: 'external-session', display: 'Wrong account title' }) + '\n');
    await writeFile(path.join(profileHome, 'history.jsonl'), JSON.stringify({ sessionId: 'external-session', display: 'Work account title' }) + '\n');
    closeConnection();
    await initializeDatabase();
    sessionsDb.createAppSession('app-work', 'claude', workspace, 'Selected profile', 'work');
    sessionsDb.assignProviderSessionId('app-work', 'work-session');
    sessionsDb.createAppSession('app-alias', 'claude', workspace, 'Alias profile', 'alias');
    sessionsDb.assignProviderSessionId('app-alias', 'alias-session');
    sessionsDb.createAppSession('app-default', 'claude', workspace, 'Default selection');
    sessionsDb.assignProviderSessionId('app-default', 'default-selection');
    const synchronizer = new ClaudeSessionSynchronizer();

    assert.equal(await synchronizer.synchronize(new Date('2100-01-01')), 5);
    assert.equal(sessionsDb.getSessionById('app-work')?.jsonl_path, workPath);
    assert.equal(sessionsDb.getSessionById('app-work')?.runtime_profile_id, 'work');
    assert.equal(sessionsDb.getSessionById('app-alias')?.runtime_profile_id, 'alias');
    assert.equal(sessionsDb.getSessionById('app-default')?.runtime_profile_id, null);
    assert.equal(sessionsDb.getSessionById('default-session')?.jsonl_path, defaultPath);
    assert.equal(sessionsDb.getSessionById('default-session')?.runtime_profile_id, null);
    assert.equal(sessionsDb.getSessionById('external-session')?.runtime_profile_id, 'work');
    assert.equal(sessionsDb.getSessionById('external-session')?.custom_name, 'Work account title');
    const history = await new ClaudeSessionsProvider().fetchHistory('app-work', { providerSessionId: 'work-session' });
    assert.ok(history.messages.some((message) => message.content === 'Work question'));
    assert.deepEqual(await new ClaudeSessionsProvider().resolveEditAnchor('app-work', 'work-session-message'), {
      found: true, resumeThroughId: null,
    });

    assert.equal(await synchronizer.synchronizeFile(aliasPath), 'app-alias');
    assert.equal(sessionsDb.getSessionById('app-alias')?.runtime_profile_id, 'alias');
    assert.equal(await synchronizer.synchronizeFile(externalPath), 'external-session');
    assert.equal(sessionsDb.getSessionById('external-session')?.custom_name, 'Work account title');
    assert.equal(await synchronizer.synchronizeFile(subagentPath), null);
    assert.equal(sessionsDb.getSessionById('app-work')?.jsonl_path, workPath);
    assert.equal(await synchronizer.synchronize(new Date('2100-01-01')), 0);

    // An added home must be scanned even when its files predate the global cursor.
    const addedHome = path.join(root, 'added');
    const addedPath = await writeTranscript(addedHome, 'added-session');
    profiles.push({ id: 'added', name: 'Added', provider: 'claude', env: { CLAUDE_CONFIG_DIR: addedHome } });
    process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify(profiles);
    assert.equal(await synchronizer.synchronize(new Date('2100-01-01')), 1);
    assert.equal(sessionsDb.getSessionById('added-session')?.jsonl_path, addedPath);
    assert.equal(sessionsDb.getSessionById('added-session')?.runtime_profile_id, 'added');
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

test('Claude watchers use unique configured roots and platform-specific profile homes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'claude-profile-watch-'));
  const saved = Object.fromEntries(['CLOUDCLI_RUNTIME_PROFILES', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const watched: string[] = [];
  const profiles = [
    { id: 'work', name: 'Work', provider: 'claude', env: { CLAUDE_CONFIG_DIR: path.join(root, 'work') } },
    { id: 'alias', name: 'Alias', provider: 'claude', env: { CLAUDE_CONFIG_DIR: path.join(root, 'work') } },
    { id: 'home', name: 'Home override', provider: 'claude', env: { HOME: path.join(root, 'posix'), USERPROFILE: path.join(root, 'windows') } },
  ];
  process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify(profiles);
  delete process.env.CLAUDE_CONFIG_DIR;
  t.mock.method(os, 'homedir', () => root);
  t.mock.method(sessionSynchronizerService, 'synchronizeSessions', async () => ({
    processedByProvider: { claude: 0, codex: 0, cursor: 0, opencode: 0 }, prunedOrphans: 0, failures: [],
  }));
  t.mock.method(chokidar, 'watch', (rootPath: string) => {
    watched.push(rootPath);
    return { on() { return this; }, async close() {} };
  });

  try {
    await initializeSessionsWatcher();
    assert.ok(watched.includes(path.join(root, '.claude', 'projects')));
    assert.equal(watched.filter((p) => p === path.join(root, 'work', 'projects')).length, 1);
    const effectiveHome = process.platform === 'win32' ? 'windows' : 'posix';
    assert.ok(watched.includes(path.join(root, effectiveHome, '.claude', 'projects')));

    for (const targetPlatform of ['win32', 'linux']) {
      Object.defineProperty(process, 'platform', { ...platform, value: targetPlatform });
      assert.equal(providerRuntimeProfilesService.listClaudeHomes().find(({ profileId }) => profileId === 'home')?.claudeHome,
        path.join(root, targetPlatform === 'win32' ? 'windows' : 'posix', '.claude'));
    }
    Object.defineProperty(process, 'platform', platform);
    await closeSessionsWatcher();
    watched.length = 0;
    process.env.CLAUDE_CONFIG_DIR = path.join(root, 'inherited');
    await initializeSessionsWatcher();
    assert.ok(watched.includes(path.join(root, 'inherited', 'projects')));
    assert.equal(watched.filter((p) => p === path.join(root, 'work', 'projects')).length, 1);
    assert.equal(watched.includes(path.join(root, '.claude', 'projects')), false);
  } finally {
    Object.defineProperty(process, 'platform', platform);
    await closeSessionsWatcher();
    t.mock.restoreAll();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
