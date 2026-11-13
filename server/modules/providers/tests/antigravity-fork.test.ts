import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { AntigravityForkProvider } from '@/modules/providers/list/antigravity/antigravity-fork.provider.js';
import { AntigravitySessionsProvider } from '@/modules/providers/list/antigravity/antigravity-sessions.provider.js';
import { AntigravitySessionSynchronizer } from '@/modules/providers/list/antigravity/antigravity-session-synchronizer.provider.js';
import { antigravityCliLivenessService } from '@/modules/providers/services/antigravity-cli-liveness.service.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

const SOURCE = '6c22c71a-dc8a-4428-9238-6ff7fdf6be2a';
const APP = 'app-source';

async function fixture(run: (input: {
  providerSessionId: string; jsonlPath: string; projectPath: string;
}, root: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'antigravity-fork-'));
  const originalHome = os.homedir;
  const databasePath = process.env.DATABASE_PATH;
  const root = path.join(home, '.gemini', 'antigravity-cli');
  const brain = path.join(root, 'brain', SOURCE);
  const jsonlPath = path.join(brain, '.system_generated', 'logs', 'transcript.jsonl');
  await mkdir(path.dirname(jsonlPath), { recursive: true });
  await mkdir(path.join(root, 'conversations'), { recursive: true });
  await writeFile(path.join(brain, 'plan.md'), 'shared context');
  const rows = [
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'first' },
    { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'answer' },
    { step_index: 2, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'second' },
    { step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'future' },
  ];
  await writeFile(jsonlPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const native = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
  native.exec('CREATE TABLE trajectory_meta (trajectory_id TEXT, cascade_id TEXT); CREATE TABLE trajectory_metadata_blob (id TEXT, data BLOB)');
  native.prepare('INSERT INTO trajectory_meta VALUES (?, ?)').run(randomUUID(), SOURCE);
  // Field 6 is the native identity; field 7 deliberately contains the source id
  // as ordinary data to ensure the implementation never replaces arbitrary bytes.
  const metadata = Buffer.concat([Buffer.from([50, 36]), Buffer.from(SOURCE), Buffer.from([58, 36]), Buffer.from(SOURCE)]);
  native.prepare('INSERT INTO trajectory_metadata_blob VALUES (?, ?)').run('main', metadata);
  for (const table of ['steps', 'gen_metadata', 'executor_metadata', 'parent_references', 'battle_mode_infos']) {
    native.exec(`CREATE TABLE ${table} (idx INTEGER PRIMARY KEY, data BLOB)`);
    if (table === 'parent_references' || table === 'battle_mode_infos') continue;
    for (let index = 0; index < 4; index += 1) native.prepare(`INSERT INTO ${table} VALUES (?, ?)`).run(index,
      table === 'steps' ? `step ${index}` : table === 'gen_metadata' ? Buffer.from([18, 1, index]) : Buffer.from([24, index]));
  }
  native.close();
  Object.defineProperty(os, 'homedir', { value: () => home, configurable: true });
  closeConnection();
  process.env.DATABASE_PATH = path.join(home, 'auth.db');
  await initializeDatabase();
  sessionsDb.createSession(APP, 'antigravity', home, 'Source title', undefined, undefined, jsonlPath);
  sessionsDb.assignProviderSessionId(APP, SOURCE);
  try {
    await run({ providerSessionId: SOURCE, jsonlPath, projectPath: home }, root);
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (databasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = databasePath;
    Object.defineProperty(os, 'homedir', { value: originalHome, configurable: true });
    await rm(home, { recursive: true, force: true });
  }
}

test('AGY full forks preserve native context, independent identities, artifacts and app ancestry', async () => {
  await fixture(async (input, root) => {
    assert.equal(providerCapabilitiesService.getProviderCapabilities('antigravity').supportsSessionForking, true);
    const before = await readFile(path.join(root, 'conversations', `${SOURCE}.db`));
    sessionsDb.setSessionModel(APP, 'custom-model');
    sessionsDb.setSessionEffort(APP, 'high');
    const result = await sessionsService.forkSessionById(APP);
    const row = sessionsDb.getSessionById(result.sessionId)!;
    assert.equal(row.forked_from_session_id, APP);
    assert.equal(row.custom_name, 'Source title (fork)');
    assert.equal(row.model, 'custom-model');
    assert.equal(row.effort, 'high');
    assert.notEqual(row.provider_session_id, SOURCE);
    assert.equal(await readFile(path.join(root, 'brain', row.provider_session_id!, 'plan.md'), 'utf8'), 'shared context');
    const history = await new AntigravitySessionsProvider().fetchHistory(result.sessionId, {
      jsonlPath: row.jsonl_path ?? undefined, providerSessionId: row.provider_session_id ?? undefined,
    });
    assert.deepEqual(history.messages.map((message) => message.content), ['first', 'answer', 'second', 'future']);
    assert.equal(history.messages[0].transcriptAnchorId, '0');
    assert.equal(history.messages[0].sessionId, result.sessionId);
    const db = new Database(path.join(root, 'conversations', `${row.provider_session_id}.db`), { readonly: true });
    try {
      assert.equal((db.prepare('SELECT cascade_id FROM trajectory_meta').get() as { cascade_id: string }).cascade_id, row.provider_session_id);
      const meta = (db.prepare('SELECT data FROM trajectory_metadata_blob').get() as { data: Buffer }).data;
      assert.equal(meta.subarray(2, 38).toString(), row.provider_session_id);
      assert.equal(meta.subarray(40).toString(), SOURCE);
    } finally { db.close(); }
    assert.deepEqual(await readFile(path.join(root, 'conversations', `${SOURCE}.db`)), before);
    assert.equal(await readFile(input.jsonlPath, 'utf8'), await readFile(row.jsonl_path!, 'utf8'));
  });
});

test('AGY ephemeral snapshots never become sidebar sessions and dispose only their own native storage', async () => {
  await fixture(async (input, root) => {
    const before = await readFile(path.join(root, 'conversations', `${SOURCE}.db`));
    chatRunRegistry.startRun({ appSessionId: APP, provider: 'antigravity', providerSessionId: SOURCE, connection: null, userId: null });
    const fork = await new AntigravityForkProvider().forkSideQuestion(input);
    const brain = path.join(root, 'brain', fork.providerSessionId);
    try {
      const agent = await readFile(path.join(fork.workingDirectory, '.agents', 'agents', `${fork.agentName}.md`), 'utf8');
      assert.match(agent, /tools:\n  - view_file\n  - grep_search\n/);
      assert.match(agent, /subagent: false/);
      await writeFile(path.join(root, 'history.jsonl'), JSON.stringify({ conversationId: fork.providerSessionId, workspace: input.projectPath }) + '\n');
      assert.equal(await new AntigravitySessionSynchronizer().synchronizeFile(fork.jsonlPath), null);
      assert.equal(sessionsDb.getSessionByProviderSessionId(fork.providerSessionId), null);
      assert.equal(await readFile(path.join(brain, 'plan.md'), 'utf8'), 'shared context');
      assert.equal(chatRunRegistry.isProcessing(APP), true, 'the parent stays active');
    } finally {
      await fork.dispose();
    }
    await fork.dispose();
    await assert.rejects(readdir(fork.workingDirectory), { code: 'ENOENT' });
    assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
    assert.deepEqual(await readdir(path.join(root, 'brain')), [SOURCE]);
    assert.deepEqual(await readFile(path.join(root, 'conversations', `${SOURCE}.db`)), before);
  });
});

test('AGY snapshots include committed WAL data and preserve independently indexed native caches', async () => {
  await fixture(async (input, root) => {
    const writer = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
    writer.pragma('journal_mode = WAL');
    writer.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(99, 'independent generation ordinal');
    writer.prepare('UPDATE steps SET data = ? WHERE idx = 0').run('committed in WAL');
    try {
      const result = await new AntigravityForkProvider().forkSession(input);
      const copy = new Database(path.join(root, 'conversations', `${result.providerSessionId}.db`), { readonly: true });
      try {
        assert.equal((copy.prepare('SELECT data FROM steps WHERE idx = 0').get() as { data: string }).data, 'committed in WAL');
        assert.equal((copy.prepare('SELECT data FROM gen_metadata WHERE idx = 99').get() as { data: string }).data, 'independent generation ordinal');
        assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
      } finally { copy.close(); }
    } finally { writer.close(); }
  });
});

test('AGY refuses stale anchors, transcript mismatches and unsupported schemas without leaving a fork', async () => {
  await fixture(async (input, root) => {
    const provider = new AntigravityForkProvider();
    for (const upToAnchorId of ['999', '../outside']) {
      await assert.rejects(provider.forkSession({ ...input, upToAnchorId }), { code: 'FORK_ANCHOR_NOT_FOUND' });
    }
    await assert.rejects(provider.forkSession({ ...input, providerSessionId: '../outside' }), { code: 'FORK_SOURCE_INVALID' });
    const wrong = path.join(root, 'wrong.jsonl'); await writeFile(wrong, '{}');
    await assert.rejects(provider.forkSession({ ...input, jsonlPath: wrong }), { code: 'FORK_SOURCE_INVALID' });
    const db = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
    db.exec('CREATE TABLE future_native_cache (idx INTEGER)'); db.close();
    await assert.rejects(provider.forkSession(input), { code: 'FORK_SOURCE_INVALID' });
    assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
    assert.deepEqual(await readdir(path.join(root, 'brain')), [SOURCE]);
  });
});

test('AGY prefix forks filter cache references rather than unrelated cache ordinals', async () => {
  await fixture(async (input, root) => {
    const sourcePath = path.join(root, 'conversations', `${SOURCE}.db`);
    const source = new Database(sourcePath);
    source.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(98, Buffer.from([42, 3, 98, 97, 100]));
    source.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(99, Buffer.from([18, 1, 0]));
    source.prepare('INSERT INTO executor_metadata VALUES (?, ?)').run(88, Buffer.from([24, 1]));
    source.close();
    const before = await readFile(sourcePath);
    const fork = await new AntigravityForkProvider().forkSession({ ...input, upToAnchorId: '1' });
    const copy = new Database(path.join(root, 'conversations', `${fork.providerSessionId}.db`));
    try {
      assert.deepEqual(copy.prepare('SELECT idx FROM steps ORDER BY idx').all(), [{ idx: 0 }, { idx: 1 }]);
      assert.deepEqual(copy.prepare('SELECT idx FROM gen_metadata ORDER BY idx').all(), [{ idx: 0 }, { idx: 1 }, { idx: 99 }]);
      assert.deepEqual(copy.prepare('SELECT idx FROM executor_metadata ORDER BY idx').all(), [{ idx: 0 }, { idx: 1 }, { idx: 88 }]);
    } finally { copy.close(); }
    const history = await new AntigravitySessionsProvider().fetchHistory('fork', { jsonlPath: fork.jsonlPath });
    assert.deepEqual(history.messages.map((message) => message.content), ['first', 'answer']);
    assert.deepEqual(await readFile(sourcePath), before);
  });
});

test('AGY edits preserve the original and retire its mapping, including edits of the first message', async () => {
  await fixture(async (_input, root) => {
    const provider = new AntigravitySessionsProvider();
    assert.deepEqual(await provider.resolveEditAnchor(APP, '2'), { found: true, resumeThroughId: '1' });
    assert.deepEqual(await provider.resolveEditAnchor(APP, '0'), { found: true, resumeThroughId: null });
    assert.equal((await provider.resolveEditAnchor(APP, '1')).found, false, 'assistant rows are not editable prompts');
    assert.equal((await provider.resolveEditAnchor(APP, '999')).found, false);
    const before = await readFile(path.join(root, 'conversations', `${SOURCE}.db`));
    await provider.rewindSession(APP, '1');
    const row = sessionsDb.getSessionById(APP)!;
    assert.notEqual(row.provider_session_id, SOURCE);
    assert.equal(sessionsDb.isProviderSessionSuperseded(SOURCE, 'antigravity'), true);
    const history = await provider.fetchHistory(APP, { jsonlPath: row.jsonl_path });
    assert.deepEqual(history.messages.map((message) => message.content), ['first', 'answer']);
    await provider.rewindSession(APP, null);
    assert.equal(sessionsDb.getSessionById(APP)?.provider_session_id, null);
    assert.deepEqual(await readFile(path.join(root, 'conversations', `${SOURCE}.db`)), before);
  });
});

test('an unsupported prefix cache leaves the original session mapping and storage unchanged', async () => {
  await fixture(async (_input, root) => {
    const db = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
    db.prepare('UPDATE gen_metadata SET data = ? WHERE idx = 2').run(Buffer.from([18, 2, 128]));
    db.close();
    await assert.rejects(new AntigravitySessionsProvider().rewindSession(APP, '1'));
    assert.equal(sessionsDb.getSessionById(APP)?.provider_session_id, SOURCE);
    assert.equal(sessionsDb.isProviderSessionSuperseded(SOURCE, 'antigravity'), false);
    assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
  });
});

test('AGY refuses managed and externally running turns before creating a fork', async () => {
  await fixture(async (_input, root) => {
    chatRunRegistry.startRun({ appSessionId: APP, provider: 'antigravity', providerSessionId: SOURCE, connection: null, userId: null });
    await assert.rejects(sessionsService.forkSessionById(APP), { code: 'SESSION_BUSY' });
    chatRunRegistry.clearAll();
    const original = antigravityCliLivenessService.getSession;
    antigravityCliLivenessService.getSession = async () => ({ providerSessionId: SOURCE, startedAt: Date.now(), canInterrupt: false });
    try { await assert.rejects(sessionsService.forkSessionById(APP), { code: 'SESSION_BUSY' }); }
    finally { antigravityCliLivenessService.getSession = original; }
    assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
  });
});
