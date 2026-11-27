import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
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
  const summaries = new Database(path.join(root, 'conversation_summaries.db'));
  summaries.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, status TEXT, not_fully_idle INTEGER, killed INTEGER, last_user_input_time TEXT)');
  summaries.close();
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
    await writeFile(path.join(root, 'history.jsonl'), JSON.stringify({ conversationId: SOURCE, workspace: _input.projectPath }));
    const synchronizer = new AntigravitySessionSynchronizer();
    assert.equal(await synchronizer.synchronizeFile(_input.jsonlPath), null);
    assert.equal(sessionsDb.getSessionByProviderSessionId(SOURCE), null);
    await new AntigravitySessionSynchronizer().synchronize(new Date());
    assert.equal(sessionsDb.getSessionByProviderSessionId(SOURCE), null, 'startup must not resurrect the retired source');

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

test('full AGY snapshots reject a database that advanced beyond the copied transcript', async () => {
  await fixture(async (input, root) => {
    const backup = Database.prototype.backup;
    Database.prototype.backup = async function (...args) {
      const writer = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
      try { writer.prepare('INSERT INTO steps VALUES (?, ?)').run(4, 'new unseen step'); }
      finally { writer.close(); }
      return backup.apply(this, args);
    };
    try {
      await assert.rejects(new AntigravityForkProvider().forkSession(input), { code: 'FORK_SOURCE_INVALID' });
      assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
      assert.deepEqual(await readdir(path.join(root, 'brain')), [SOURCE]);
    } finally { Database.prototype.backup = backup; }
  });
});


test('AGY rejects linked artifacts without retaining a fork or modifying the source', async () => {
  await fixture(async (input, root) => {
    const brain = path.join(root, 'brain', SOURCE);
    await mkdir(path.join(brain, 'nested'));
    await symlink(path.join(brain, 'plan.md'), path.join(brain, 'nested', 'linked.md'));
    await assert.rejects(new AntigravityForkProvider().forkSession(input), { code: 'FORK_SOURCE_INVALID' });
    assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
    assert.deepEqual(await readdir(path.join(root, 'brain')), [SOURCE]);
    assert.equal(await readFile(path.join(brain, 'plan.md'), 'utf8'), 'shared context');
  });
});

test('AGY rejects prefix caches referencing a missing native step', async () => {
  await fixture(async (input, root) => {
    const source = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
    source.prepare('DELETE FROM steps WHERE idx = 1').run();
    source.close();
    await assert.rejects(new AntigravityForkProvider().forkSession({ ...input, upToAnchorId: '2' }), { code: 'FORK_SOURCE_INVALID' });
    assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
    assert.deepEqual(await readdir(path.join(root, 'brain')), [SOURCE]);
  });
});


test('AGY side snapshot cancellation during native backup removes only owned artifacts', async () => {
  await fixture(async (input, root) => {
    const controller = new AbortController();
    const backup = Database.prototype.backup;
    Database.prototype.backup = function(destination, options) {
      return backup.call(this, destination, { ...options, progress: (progress) => {
        controller.abort(new Error('dismissed during backup'));
        return options?.progress?.(progress) ?? 100;
      } });
    };
    try {
      await assert.rejects(new AntigravityForkProvider().forkSideQuestion({ ...input, signal: controller.signal }), /dismissed during backup/);
      assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
      assert.deepEqual(await readdir(path.join(root, 'brain')), [SOURCE]);
    } finally { Database.prototype.backup = backup; }
  });
});

test('AGY app persistence failure rolls back its native fork', async () => {
  await fixture(async (_input, root) => {
    const create = sessionsDb.createForkedSession;
    sessionsDb.createForkedSession = () => { throw new Error('injected app persistence failure'); };
    try {
      await assert.rejects(sessionsService.forkSessionById(APP), /injected app persistence failure/);
      assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
      assert.deepEqual(await readdir(path.join(root, 'brain')), [SOURCE]);
      assert.equal(sessionsDb.getSessionById(APP)?.provider_session_id, SOURCE);
    } finally { sessionsDb.createForkedSession = create; }
  });
});


test('AGY rejects executor references encoded as bytes instead of protobuf integers', async () => {
  await fixture(async (input, root) => {
    const source = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
    source.prepare('UPDATE executor_metadata SET data = ? WHERE idx = 0').run(Buffer.from([26, 1, 48]));
    source.close();
    await assert.rejects(new AntigravityForkProvider().forkSession({ ...input, upToAnchorId: '2' }), { code: 'FORK_SOURCE_INVALID' });
    assert.deepEqual(await readdir(path.join(root, 'conversations')), [`${SOURCE}.db`]);
  });
});

test('AGY forks retain opaque uint64 metadata above the JavaScript safe-integer range', async () => {
  await fixture(async (input, root) => {
    const database = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
    const metadata = (database.prepare('SELECT data FROM trajectory_metadata_blob').get() as { data: Buffer }).data;
    const opaque = Buffer.from([64, 128, 128, 128, 128, 128, 128, 128, 128, 16]); // field 8 = 2^60
    database.prepare('UPDATE trajectory_metadata_blob SET data = ?').run(Buffer.concat([metadata, opaque]));
    database.close();
    const result = await new AntigravityForkProvider().forkSession(input);
    const fork = new Database(path.join(root, 'conversations', `${result.providerSessionId}.db`), { readonly: true });
    try {
      const saved = (fork.prepare('SELECT data FROM trajectory_metadata_blob').get() as { data: Buffer }).data;
      assert.deepEqual(saved.subarray(-opaque.length), opaque);
    } finally { fork.close(); }
  });
});


test('review-3 regression: generation references reject fixed-width wire types and accept unpacked integers', async () => {
  await fixture(async (input, root) => {
    const source = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
    try {
      for (const bytes of [[21, 0, 0, 0, 0], [17, 0, 0, 0, 0, 0, 0, 0, 0]]) {
        source.prepare('UPDATE gen_metadata SET data = ? WHERE idx = 0').run(Buffer.from(bytes));
        await assert.rejects(new AntigravityForkProvider().forkSession({ ...input, upToAnchorId: '2' }), { code: 'FORK_SOURCE_INVALID' });
      }
      source.prepare('UPDATE gen_metadata SET data = ? WHERE idx = 0').run(Buffer.from([16, 0]));
      const fork = await new AntigravityForkProvider().forkSession({ ...input, upToAnchorId: '2' });
      await fork.dispose();
    } finally { source.close(); }
  });
});


test('review-4 regression: snapshots reject a missing interior transcript step', async () => {
  await fixture(async (input, root) => {
    const source = new Database(path.join(root, 'conversations', `${SOURCE}.db`));
    try {
      for (const table of ['steps', 'gen_metadata', 'executor_metadata']) source.prepare(`DELETE FROM ${table} WHERE idx = 1`).run();
      await assert.rejects(new AntigravityForkProvider().forkSession({ ...input, upToAnchorId: '2' }), { code: 'FORK_SOURCE_INVALID' });
    } finally { source.close(); }
  });
});

test('review-4 regression: failed transcript cleanup still removes native snapshot database', async () => {
  await fixture(async (input, root) => {
    const fork = await new AntigravityForkProvider().forkSideQuestion(input);
    await rm(fork.jsonlPath); await mkdir(fork.jsonlPath);
    await assert.rejects(fork.dispose(), /snapshot cleanup failed/);
    await assert.rejects(readFile(path.join(root, 'conversations', `${fork.providerSessionId}.db`)), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(root, 'brain', fork.providerSessionId, '.cloudcli-side-question'), 'utf8'), '');
    await rm(fork.jsonlPath, { recursive: true }); await fork.dispose();
  });
});


test('review-5 regression: native backup destination is private before any copied bytes', async (context) => {
  const original = Database.prototype.backup;
  let checked = false;
  context.mock.method(Database.prototype, 'backup', async function(this: Database.Database, ...args: Parameters<typeof original>) {
    const info = await stat(args[0]); checked = true;
    if (process.platform !== 'win32') assert.equal(info.mode & 0o777, 0o600);
    return original.apply(this, args);
  });
  await fixture(async (input) => {
    const fork = await new AntigravityForkProvider().forkSession(input);
    try { assert.equal(checked, true); } finally { await fork.dispose(); }
  });
});


test('review-8 regression: an unpublished explicit fork cannot be indexed before app persistence', async () => {
  await fixture(async (input, root) => {
    const fork = await new AntigravityForkProvider().forkSession(input);
    try {
      await writeFile(path.join(root, 'history.jsonl'), JSON.stringify({ conversationId: fork.providerSessionId, workspace: input.projectPath }));
      const sync = new AntigravitySessionSynchronizer();
      assert.equal(await sync.synchronizeFile(fork.jsonlPath), null);
      assert.equal(sessionsDb.getSessionByProviderSessionId(fork.providerSessionId), null);
      sessionsDb.createForkedSession({
        sessionId: 'durable-fork',
        provider: 'antigravity',
        projectPath: input.projectPath,
        customName: 'Fork',
        providerSessionId: fork.providerSessionId,
        jsonlPath: fork.jsonlPath,
        forkedFromSessionId: APP,
        model: null,
        effort: null,
      });
      assert.equal(await sync.synchronizeFile(fork.jsonlPath), 'durable-fork');
      // A fork of a fork must not try to copy its predecessor's ownership marker.
      const next = await new AntigravityForkProvider().forkSession({ ...input, providerSessionId: fork.providerSessionId, jsonlPath: fork.jsonlPath });
      await next.dispose();
    } finally { await fork.dispose(); }
  });
});
