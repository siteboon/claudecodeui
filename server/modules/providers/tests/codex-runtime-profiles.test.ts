import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import chokidar from 'chokidar';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { providerRuntimeProfilesService } from '@/modules/providers/services/provider-runtime-profiles.service.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { closeSessionsWatcher, initializeSessionsWatcher } from '@/modules/providers/services/sessions-watcher.service.js';

test('Codex profile transcripts remain usable for history, forks, and edits', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-profile-'));
  const saved = Object.fromEntries(['DATABASE_PATH', 'CLOUDCLI_RUNTIME_PROFILES', 'CODEX_HOME'].map((key) => [key, process.env[key]]));
  const profileHome = path.join(root, 'work');
  const workspace = path.join(root, 'workspace');
  const sessionsDirectory = path.join(profileHome, 'sessions', '2026', '09', '24');
  const nativeId = '01a02a80-dfb9-7882-8013-00e41955e656';
  const transcriptPath = path.join(sessionsDirectory, `rollout-2026-09-24T13-00-00-${nativeId}.jsonl`);
  process.env.CODEX_HOME = path.join(root, 'default');
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify([
    { id: 'work', name: 'Work', provider: 'codex', env: { CODEX_HOME: profileHome } },
    { id: 'same-root', name: 'Same root', provider: 'codex', env: { CODEX_HOME: profileHome } },
  ]);

  try {
    await mkdir(sessionsDirectory, { recursive: true });
    await mkdir(workspace);
    const timestamp = '2026-09-24T13:00:00.000Z';
    const rows = [
      { type: 'session_meta', payload: { id: nativeId, cwd: workspace, timestamp,
        originator: 'codex_cli_rs', cli_version: '0.153.4', source: 'cli', model_provider: 'openai' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Work question' }] } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Work question' } },
    ];
    const original = rows.map((row) => JSON.stringify({ timestamp, ...row })).join('\n') + '\n';
    await writeFile(transcriptPath, original);
    await writeFile(path.join(profileHome, 'session_index.jsonl'), JSON.stringify({ id: nativeId, thread_name: 'Work history' }) + '\n');
    closeConnection();
    await initializeDatabase();
    sessionsDb.createAppSession('app-work', 'codex', workspace, 'Selected profile', 'work');
    sessionsDb.assignProviderSessionId('app-work', nativeId);
    const synchronizer = new CodexSessionSynchronizer();

    // The global cursor may be newer than an operator's newly added home.
    assert.equal(await synchronizer.synchronize(new Date('2100-01-01')), 1);
    assert.equal(sessionsDb.getSessionById('app-work')?.jsonl_path, transcriptPath);
    assert.equal(sessionsDb.getSessionById('app-work')?.runtime_profile_id, 'work');
    assert.equal(sessionsService.resolveRuntimeProfile('codex', 'app-work').id, 'work');
    assert.equal(sessionsService.resolveRuntimeProfile('codex', nativeId).id, 'work');
    assert.throws(() => sessionsService.resolveRuntimeProfile('claude', nativeId), /does not belong to claude/);
    const history = await new CodexSessionsProvider().fetchHistory('app-work');
    assert.ok(history.messages.some((message) => message.content === 'Work question'));

    // Watcher updates resolve the same profile's index and retain an app's exact selection.
    sessionsDb.createAppSession('app-alias', 'codex', workspace, 'Alias', 'same-root');
    sessionsDb.assignProviderSessionId('app-alias', 'alias-thread');
    const aliasPath = path.join(sessionsDirectory, 'rollout-alias-thread.jsonl');
    await writeFile(aliasPath, JSON.stringify({ timestamp, type: 'session_meta', payload: { id: 'alias-thread', cwd: workspace } }) + '\n');
    assert.equal(await synchronizer.synchronizeFile(aliasPath), 'app-alias');
    assert.equal(sessionsDb.getSessionById('app-alias')?.runtime_profile_id, 'same-root');
    assert.equal(await synchronizer.synchronizeFile(path.join(root, 'outside.jsonl')), null);

    sessionsDb.createAppSession('app-default', 'codex', workspace, 'Default');
    sessionsDb.assignProviderSessionId('app-default', 'default-thread');
    const defaultPath = path.join(sessionsDirectory, 'rollout-default-thread.jsonl');
    await writeFile(defaultPath, JSON.stringify({ timestamp, type: 'session_meta', payload: { id: 'default-thread', cwd: workspace } }) + '\n');
    await synchronizer.synchronizeFile(defaultPath);
    assert.equal(sessionsDb.getSessionById('app-default')?.runtime_profile_id, null);

    const externalPath = path.join(sessionsDirectory, 'rollout-external-thread.jsonl');
    await writeFile(externalPath, JSON.stringify({ timestamp, type: 'session_meta', payload: { id: 'external-thread', cwd: workspace } }) + '\n');
    await synchronizer.synchronizeFile(externalPath);
    assert.equal(sessionsDb.getSessionById('external-thread')?.runtime_profile_id, 'work');

    // The bundled app-server only copies transcript data here; it runs no model turn.
    const fork = await sessionsService.forkSessionById('app-work');
    const forkRow = sessionsDb.getSessionById(fork.sessionId);
    assert.equal(forkRow?.runtime_profile_id, 'work');
    assert.ok(forkRow?.jsonl_path?.startsWith(profileHome + path.sep));
    assert.ok((await new CodexSessionsProvider().fetchHistory(fork.sessionId)).messages.length > 0);
    assert.equal(await readFile(transcriptPath, 'utf8'), original);

    // Capture the rewind's transport while still exercising the real app-server.
    const { codexAppServer } = await import('@/modules/providers/list/codex/codex-app-server.client.js');
    const forkThread = codexAppServer.forkThread.bind(codexAppServer);
    const calls: Parameters<typeof forkThread>[0][] = [];
    t.mock.method(codexAppServer, 'forkThread', async (input: Parameters<typeof forkThread>[0]) => {
      calls.push(input);
      // No turn boundary is needed to check profile/path propagation.
      return forkThread({ ...input, lastTurnId: undefined });
    });
    await new CodexSessionsProvider().rewindSession('app-work', 'kept-turn');
    assert.equal(calls[0]?.jsonlPath, transcriptPath);
    assert.equal(calls[0]?.runtimeProfile?.id, 'work');
    assert.equal(sessionsDb.getSessionById('app-work')?.runtime_profile_id, 'work');
    assert.ok(sessionsDb.getSessionById('app-work')?.jsonl_path?.startsWith(profileHome + path.sep));
    assert.equal(await readFile(transcriptPath, 'utf8'), original);
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

test('session watchers include each configured Codex home once', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-profile-watch-'));
  const saved = Object.fromEntries(['CLOUDCLI_RUNTIME_PROFILES', 'CODEX_HOME'].map((key) => [key, process.env[key]]));
  process.env.CODEX_HOME = path.join(root, 'default');
  process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify([
    { id: 'work', name: 'Work', provider: 'codex', env: { CODEX_HOME: path.join(root, 'work') } },
    { id: 'duplicate', name: 'Duplicate', provider: 'codex', env: { CODEX_HOME: path.join(root, 'work') } },
  ]);
  const watched: string[] = [];
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
    assert.deepEqual(providerRuntimeProfilesService.listCodexHomes().map(({ codexHome }) => codexHome), [
      path.join(root, 'default'), path.join(root, 'work'),
    ]);
    assert.ok(watched.includes(path.join(root, 'default', 'sessions')));
    assert.equal(watched.filter((p) => p === path.join(root, 'work', 'sessions')).length, 1);
  } finally {
    await closeSessionsWatcher();
    t.mock.restoreAll();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex discovery does not replace the owning home title with a copied profile title', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-profile-title-'));
  const saved = Object.fromEntries(['DATABASE_PATH', 'CODEX_HOME', 'CLOUDCLI_RUNTIME_PROFILES'].map((key) => [key, process.env[key]]));
  const homes = [path.join(root, 'default'), path.join(root, 'work')];
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  process.env.CODEX_HOME = homes[0];
  process.env.CLOUDCLI_RUNTIME_PROFILES = JSON.stringify([
    { id: 'work', name: 'Work', provider: 'codex', env: { CODEX_HOME: homes[1] } },
  ]);
  try {
    for (const home of homes) {
      await mkdir(path.join(home, 'sessions'), { recursive: true });
      await writeFile(path.join(home, 'sessions', 'copied.jsonl'), JSON.stringify({
        type: 'session_meta', payload: { id: 'copied', cwd: root },
      }) + '\n');
    }
    await writeFile(path.join(homes[1], 'session_index.jsonl'), JSON.stringify({
      id: 'copied', thread_name: 'Other account title',
    }) + '\n');
    closeConnection();
    await initializeDatabase();
    await new CodexSessionSynchronizer().synchronize();
    const row = sessionsDb.getSessionById('copied');
    assert.equal(row?.custom_name, 'Untitled Codex Session');
    assert.equal(row?.jsonl_path, path.join(homes[0], 'sessions', 'copied.jsonl'));
    assert.equal(row?.runtime_profile_id, null);
  } finally {
    closeConnection();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
