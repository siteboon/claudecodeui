/**
 * Integration test for the omp jsonl synchronizer + history reader.
 *
 * Isolated SQLite DB + tmp `~/.omp/agent/sessions` tree: drops a fixture jsonl
 * (header + title + a toolCall/toolResult pair + usage), runs synchronizeFile,
 * then fetchHistory — asserting the DB row and the normalized/paged messages.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
const ORIGINAL_DB = process.env.DATABASE_PATH;

const SESSION_ID = 'testsession01';
const CWD = '/work/omp-proj';
let tempHome: string;
let tempDbDir: string;
let jsonlPath: string;

const FIXTURE_LINES = [
  { type: 'session', version: 3, id: SESSION_ID, timestamp: '2026-07-21T00:00:00.000Z', cwd: CWD },
  { type: 'title', v: 1, title: 'My omp Session', source: 'auto' },
  { type: 'message', id: 'm1', message: { role: 'user', content: [{ type: 'text', text: 'run ls' }] } },
  {
    type: 'message',
    id: 'm2',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'let me list files' },
        { type: 'text', text: 'Listing now' },
        // omp's real on-disk shape: camelCase `toolCall` with `arguments` (not
        // the Anthropic `tool_use`/`input`).
        { type: 'toolCall', id: 'tool1', name: 'Bash', arguments: { command: 'ls' } },
      ],
      usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0, totalTokens: 120 },
    },
  },
  // omp records the result as its own message with role `toolResult`, linked by
  // `toolCallId`, content as text blocks.
  { type: 'message', id: 'm3', message: { role: 'toolResult', toolCallId: 'tool1', toolName: 'Bash', content: [{ type: 'text', text: 'file.txt' }] } },
];

before(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'omp-sync-home-'));
  tempDbDir = await mkdtemp(path.join(tmpdir(), 'omp-sync-db-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.DATABASE_PATH = path.join(tempDbDir, 'auth.db');

  const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-proj');
  await mkdir(slugDir, { recursive: true });
  jsonlPath = path.join(slugDir, `2026-07-21T00-00-00-000Z_${SESSION_ID}.jsonl`);
  await writeFile(jsonlPath, FIXTURE_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n');
});

after(async () => {
  if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME; else delete process.env.HOME;
  if (ORIGINAL_USERPROFILE !== undefined) process.env.USERPROFILE = ORIGINAL_USERPROFILE; else delete process.env.USERPROFILE;
  if (ORIGINAL_DB !== undefined) process.env.DATABASE_PATH = ORIGINAL_DB; else delete process.env.DATABASE_PATH;
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
  if (tempDbDir) await rm(tempDbDir, { recursive: true, force: true });
});

describe('omp synchronizer + fetchHistory', () => {
  it('indexes a jsonl into a sessions row and reads paged history back', async () => {
    const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
    const { OmpSessionSynchronizer } = await import('@/modules/providers/list/omp/omp-session-synchronizer.provider.js');
    const { OmpSessionsProvider } = await import('@/modules/providers/list/omp/omp-sessions.provider.js');

    closeConnection();
    await initializeDatabase();

    // --- synchronizer ---
    const synchronizer = new OmpSessionSynchronizer();
    const upsertedId = await synchronizer.synchronizeFile(jsonlPath);
    assert.equal(upsertedId, SESSION_ID);

    const row = sessionsDb.getSessionById(SESSION_ID);
    assert.ok(row, 'session row should exist');
    assert.equal(row.provider, 'omp');
    assert.equal(row.project_path, CWD);
    assert.equal(row.custom_name, 'My omp Session');
    assert.equal(row.jsonl_path, jsonlPath);

    // --- fetchHistory (full) ---
    const provider = new OmpSessionsProvider();
    const all = await provider.fetchHistory(SESSION_ID, {});
    const kinds = all.messages.map((m) => m.kind);
    assert.deepEqual(kinds, ['text', 'thinking', 'text', 'tool_use']);
    assert.equal(all.total, 4, 'the attached tool result does not add a transcript row');

    const toolUse = all.messages.find((m) => m.kind === 'tool_use')!;
    assert.equal(toolUse.toolName, 'Bash');
    assert.equal(toolUse.toolId, 'tool1');
    assert.deepEqual(toolUse.toolInput, { command: 'ls' });
    assert.deepEqual(toolUse.toolResult, { content: 'file.txt', isError: false });

    const userText = all.messages.find((m) => m.kind === 'text' && m.role === 'user')!;
    assert.equal(userText.content, 'run ls');

    // --- paging (tail) ---
    const tail = await provider.fetchHistory(SESSION_ID, { limit: 2, offset: 0 });
    assert.equal(tail.messages.length, 2);
    assert.equal(tail.hasMore, true);
    assert.equal(tail.messages.at(-1)!.kind, 'tool_use', 'newest rendered entry is last');
    assert.deepEqual(tail.messages.at(-1)!.toolResult, { content: 'file.txt', isError: false });

    closeConnection();
  });

  it('renders only the active branch of a forked transcript', async () => {
    // An omp jsonl is a tree: continuing from an earlier point (terminal history
    // navigation, or a second omp process resuming a stale copy) appends a SECOND
    // child under that parent. Read in file order the two branches interleave.
    const { closeConnection, initializeDatabase } = await import('@/modules/database/index.js');
    const { OmpSessionsProvider } = await import('@/modules/providers/list/omp/omp-sessions.provider.js');

    closeConnection();
    await initializeDatabase();

    const NATIVE = 'forkedsession03';
    const cwd3 = '/work/omp-proj3';
    const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-proj3');
    await mkdir(slugDir, { recursive: true });
    const jsonl3 = path.join(slugDir, `2026-07-21T02-00-00-000Z_${NATIVE}.jsonl`);
    const msg = (id: string, parentId: string | null, role: string, text: string) => JSON.stringify({
      type: 'message', id, parentId, message: { role, content: [{ type: 'text', text }] },
    });
    await writeFile(jsonl3, [
      JSON.stringify({ type: 'session', version: 3, id: NATIVE, timestamp: '2026-07-21T02:00:00.000Z', cwd: cwd3 }),
      msg('m1', null, 'user', 'first question'),
      msg('m2', 'm1', 'assistant', 'first answer'),
      // abandoned branch, interleaved with the live one exactly as two writers leave it
      msg('b1', 'm2', 'user', 'abandoned question'),
      msg('c1', 'm2', 'user', 'live question'),
      msg('b2', 'b1', 'assistant', 'abandoned answer'),
      msg('c2', 'c1', 'assistant', 'live answer'),
      // The LAST line of a real forked file is usually the exit marker of whichever
      // omp process died first, parented to the head IT held — here the abandoned
      // branch. Taking it as the head would render the dead branch and hide the
      // live one, which is the very symptom this filter exists to remove.
      JSON.stringify({
        type: 'custom', customType: 'session_exit', id: 'x1', parentId: 'b2',
        data: { reason: 'sigint' },
      }),
    ].join('\n') + '\n');

    const provider = new OmpSessionsProvider();
    const history = await provider.fetchHistory(NATIVE, {});
    assert.deepEqual(
      history.messages.map((m) => m.content),
      ['first question', 'first answer', 'live question', 'live answer'],
      'the newest RENDERED entry picks the branch, not a trailing lifecycle marker',
    );

    closeConnection();
  });

  it('a custom_message cannot head a branch this reader does not render', async () => {
    // `custom_message` entries (collab prompts, mount notices) exist in real omp
    // transcripts, but normalizeJsonlMessage draws none of them. Admitting one as
    // a candidate head crowned an invisible entry and rendered the dead branch.
    const { closeConnection, initializeDatabase } = await import('@/modules/database/index.js');
    const { OmpSessionsProvider } = await import('@/modules/providers/list/omp/omp-sessions.provider.js');

    closeConnection();
    await initializeDatabase();

    const NATIVE = 'customheadsession05';
    const cwd5 = '/work/omp-proj5';
    const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-proj5');
    await mkdir(slugDir, { recursive: true });
    const jsonl5 = path.join(slugDir, `2026-07-21T05-00-00-000Z_${NATIVE}.jsonl`);
    const msg = (id: string, parentId: string | null, role: string, text: string) => JSON.stringify({
      type: 'message', id, parentId, message: { role, content: [{ type: 'text', text }] },
    });
    await writeFile(jsonl5, [
      JSON.stringify({ type: 'session', version: 3, id: NATIVE, timestamp: '2026-07-21T05:00:00.000Z', cwd: cwd5 }),
      msg('m1', null, 'user', 'first question'),
      msg('m2', 'm1', 'assistant', 'first answer'),
      msg('b1', 'm2', 'user', 'abandoned question'),
      msg('c1', 'm2', 'user', 'live question'),
      msg('b2', 'b1', 'assistant', 'abandoned answer'),
      msg('c2', 'c1', 'assistant', 'live answer'),
      // Newest line in the file, parented to the ABANDONED head.
      JSON.stringify({
        type: 'custom_message', customType: 'collab-prompt', id: 'k1', parentId: 'b2',
        details: { from: 'someone', content: 'a message this reader does not render' },
      }),
    ].join('\n') + '\n');

    const provider = new OmpSessionsProvider();
    const history = await provider.fetchHistory(NATIVE, {});
    assert.deepEqual(
      history.messages.map((m) => m.content),
      ['first question', 'first answer', 'live question', 'live answer'],
      'an unrenderable newest entry must not decide the branch',
    );

    closeConnection();
  });

  it('falls back to file order when a fork cannot be resolved', async () => {
    // Every ambiguous case must degrade to the old interleaved view: showing both
    // branches is recoverable, hiding the live one is not.
    const { closeConnection, initializeDatabase } = await import('@/modules/database/index.js');
    const { OmpSessionsProvider } = await import('@/modules/providers/list/omp/omp-sessions.provider.js');

    closeConnection();
    await initializeDatabase();

    const NATIVE = 'brokensession04';
    const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-proj4');
    await mkdir(slugDir, { recursive: true });
    const jsonl4 = path.join(slugDir, `2026-07-21T03-00-00-000Z_${NATIVE}.jsonl`);
    const msg = (id: string, parentId: string | null, role: string, text: string) => JSON.stringify({
      type: 'message', id, parentId, message: { role, content: [{ type: 'text', text }] },
    });
    await writeFile(jsonl4, [
      JSON.stringify({ type: 'session', version: 3, id: NATIVE, timestamp: '2026-07-21T03:00:00.000Z', cwd: '/work/omp-proj4' }),
      msg('m1', null, 'user', 'first question'),
      msg('b1', 'm1', 'user', 'abandoned question'),
      // `gone` is missing from the file — a malformed line the reader dropped. The
      // chain from the newest entry breaks, so nothing above it can be placed.
      msg('c1', 'gone', 'user', 'live question'),
    ].join('\n') + '\n');

    const provider = new OmpSessionsProvider();
    const history = await provider.fetchHistory(NATIVE, {});
    assert.deepEqual(
      history.messages.map((m) => m.content),
      ['first question', 'abandoned question', 'live question'],
      'a broken chain keeps every message instead of dropping the transcript above it',
    );

    closeConnection();
  });

  it('preserves a user rename on an APP-created row across re-sync (bug #1)', async () => {
    const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
    const { OmpSessionSynchronizer } = await import('@/modules/providers/list/omp/omp-session-synchronizer.provider.js');

    closeConnection();
    await initializeDatabase();

    const NATIVE = 'renamesession02';
    const cwd2 = '/work/omp-proj2';
    const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-proj2');
    await mkdir(slugDir, { recursive: true });
    const jsonl2 = path.join(slugDir, `2026-07-21T01-00-00-000Z_${NATIVE}.jsonl`);
    await writeFile(jsonl2, [
      JSON.stringify({ type: 'session', version: 3, id: NATIVE, timestamp: '2026-07-21T01:00:00.000Z', cwd: cwd2 }),
      JSON.stringify({ type: 'title', v: 1, title: 'Auto Generated Title', source: 'auto' }),
      JSON.stringify({ type: 'message', id: 'x1', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
    ].join('\n') + '\n');

    // App-created row: session_id = app id, provider_session_id = native id.
    const appId = sessionsDb.createAppSession('app-id-xyz', 'omp', cwd2);
    sessionsDb.assignProviderSessionId(appId, NATIVE);
    sessionsDb.updateSessionCustomName(appId, 'User Renamed', 'user');

    await new OmpSessionSynchronizer().synchronizeFile(jsonl2);

    const row = sessionsDb.getSessionByProviderSessionId(NATIVE);
    assert.equal(row?.custom_name, 'User Renamed', 'user rename must survive re-sync (not clobbered by the jsonl auto-title)');

    closeConnection();
  });

  it('follows an omp retitle on a row the watcher discovered', async () => {
    const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
    const { OmpSessionSynchronizer } = await import('@/modules/providers/list/omp/omp-session-synchronizer.provider.js');

    closeConnection();
    await initializeDatabase();

    const NATIVE = 'retitlesession01';
    const cwd3 = '/work/omp-proj3';
    const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-proj3');
    await mkdir(slugDir, { recursive: true });
    const jsonl3 = path.join(slugDir, `2026-07-21T02-00-00-000Z_${NATIVE}.jsonl`);
    const transcript = (title: string): string => [
      JSON.stringify({ type: 'title', v: 1, title, source: 'auto', updatedAt: '2026-07-21T02:05:00.000Z' }),
      JSON.stringify({ type: 'session', version: 3, id: NATIVE, timestamp: '2026-07-21T02:00:00.000Z', cwd: cwd3 }),
      JSON.stringify({ type: 'message', id: 'y1', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
    ].join('\n') + '\n';

    const synchronizer = new OmpSessionSynchronizer();
    await writeFile(jsonl3, transcript('First Auto Title'));
    await synchronizer.synchronizeFile(jsonl3);
    assert.equal(sessionsDb.getSessionByProviderSessionId(NATIVE)?.custom_name, 'First Auto Title');

    // omp rewrites the title header in place as the session goes on.
    await writeFile(jsonl3, transcript('Second Auto Title'));
    await synchronizer.synchronizeFile(jsonl3);

    const row = sessionsDb.getSessionByProviderSessionId(NATIVE);
    assert.equal(row?.custom_name, 'Second Auto Title', 'a retitle in omp must reach the sidebar');
    assert.equal(row?.provider_name, 'Second Auto Title', 'the watermark tracks the title that was read');

    closeConnection();
  });

  it('does not expose a leaked omp auto-title wrapper', async () => {
    const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
    const { OmpSessionSynchronizer } = await import('@/modules/providers/list/omp/omp-session-synchronizer.provider.js');

    closeConnection();
    await initializeDatabase();

    const NATIVE = 'malformedtitle01';
    const cwd = '/work/omp-malformed-title';
    const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-malformed-title');
    await mkdir(slugDir, { recursive: true });
    const jsonl = path.join(slugDir, `2026-07-21T02-30-00-000Z_${NATIVE}.jsonl`);
    await writeFile(jsonl, [
      JSON.stringify({ type: 'title', v: 1, title: '<title', source: 'auto' }),
      JSON.stringify({ type: 'session', version: 3, id: NATIVE, timestamp: '2026-07-21T02:30:00.000Z', cwd }),
      JSON.stringify({
        type: 'message',
        id: 'malformed-title-user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Check monitoring status and alerts' }],
        },
      }),
    ].join('\n') + '\n');

    sessionsDb.createSession(NATIVE, 'omp', cwd, '<title', undefined, undefined, jsonl);
    sessionsDb.updateSessionProviderName(NATIVE, '<title');

    await new OmpSessionSynchronizer().synchronizeFile(jsonl);

    const row = sessionsDb.getSessionByProviderSessionId(NATIVE);
    assert.equal(row?.custom_name, 'Check monitoring status and');
    assert.equal(row?.provider_name, 'Check monitoring status and');

    await writeFile(jsonl, [
      JSON.stringify({ type: 'title', v: 1, title: '<title', source: 'auto' }),
      JSON.stringify({ type: 'session', version: 3, id: NATIVE, timestamp: '2026-07-21T02:30:00.000Z', cwd }),
      JSON.stringify({
        type: 'message',
        id: 'malformed-title-user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Check monitoring status and alerts' }],
        },
      }),
      JSON.stringify({ type: 'title_change', title: 'Recovered Monitoring Title', source: 'auto' }),
    ].join('\n') + '\n');
    sessionsDb.updateSessionCustomName(NATIVE, '<title', 'provider');
    sessionsDb.updateSessionProviderName(NATIVE, '<title');

    await new OmpSessionSynchronizer().synchronizeFile(jsonl);

    const recoveredRow = sessionsDb.getSessionByProviderSessionId(NATIVE);
    assert.equal(recoveredRow?.custom_name, 'Recovered Monitoring Title');
    assert.equal(recoveredRow?.provider_name, 'Recovered Monitoring Title');

    closeConnection();
  });

  it('keeps a CloudCLI rename when omp only auto-retitles', async () => {
    const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
    const { OmpSessionSynchronizer } = await import('@/modules/providers/list/omp/omp-session-synchronizer.provider.js');

    closeConnection();
    await initializeDatabase();

    const NATIVE = 'retitlesession02';
    const cwd4 = '/work/omp-proj4';
    const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-proj4');
    await mkdir(slugDir, { recursive: true });
    const jsonl4 = path.join(slugDir, `2026-07-21T03-00-00-000Z_${NATIVE}.jsonl`);
    const transcript = (title: string, source: string): string => [
      JSON.stringify({ type: 'title', v: 1, title, source }),
      JSON.stringify({ type: 'session', version: 3, id: NATIVE, timestamp: '2026-07-21T03:00:00.000Z', cwd: cwd4 }),
      JSON.stringify({ type: 'message', id: 'z1', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
    ].join('\n') + '\n';

    const synchronizer = new OmpSessionSynchronizer();
    await writeFile(jsonl4, transcript('Auto One', 'auto'));
    await synchronizer.synchronizeFile(jsonl4);
    sessionsDb.updateSessionCustomName(NATIVE, 'Named Here', 'user');

    await writeFile(jsonl4, transcript('Auto Two', 'auto'));
    await synchronizer.synchronizeFile(jsonl4);
    assert.equal(
      sessionsDb.getSessionByProviderSessionId(NATIVE)?.custom_name,
      'Named Here',
      'an auto title must never overwrite a name set in the app',
    );

    // An explicit rename in omp is the newer intent, so that one does win.
    await writeFile(jsonl4, transcript('Renamed In omp', 'user'));
    await synchronizer.synchronizeFile(jsonl4);
    assert.equal(sessionsDb.getSessionByProviderSessionId(NATIVE)?.custom_name, 'Renamed In omp');

    sessionsDb.updateSessionCustomName(NATIVE, 'Named After omp', 'user');
    await synchronizer.synchronizeFile(jsonl4);
    assert.equal(
      sessionsDb.getSessionByProviderSessionId(NATIVE)?.custom_name,
      'Named After omp',
      'an unchanged omp title must not overwrite a newer app rename',
    );

    sessionsDb.updateSessionCustomName(NATIVE, 'Renamed In omp', 'user');
    await writeFile(jsonl4, transcript('Auto Three', 'auto'));
    await synchronizer.synchronizeFile(jsonl4);
    assert.equal(
      sessionsDb.getSessionByProviderSessionId(NATIVE)?.custom_name,
      'Renamed In omp',
      'user ownership must survive even when the app name equals the old watermark',
    );

    closeConnection();
  });

  it('replaces a provisional APP-created name with omp\'s auto title', async () => {
    const {
      closeConnection,
      getConnection,
      initializeDatabase,
      sessionsDb,
    } = await import('@/modules/database/index.js');
    const { OmpSessionSynchronizer } = await import('@/modules/providers/list/omp/omp-session-synchronizer.provider.js');

    closeConnection();
    await initializeDatabase();

    const NATIVE = 'retitlesession03';
    const cwd5 = '/work/omp-proj5';
    const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-proj5');
    await mkdir(slugDir, { recursive: true });
    const jsonl5 = path.join(slugDir, `2026-07-21T04-00-00-000Z_${NATIVE}.jsonl`);
    const session = {
      type: 'session',
      version: 3,
      id: NATIVE,
      timestamp: '2026-07-21T04:00:00.000Z',
      cwd: cwd5,
    };
    const untitledSessionEntry = JSON.stringify(session);
    const sessionEntry = JSON.stringify({
      ...session,
      title: 'Increase default chat history load',
      titleSource: 'auto',
    });
    const userEntry = JSON.stringify({
      type: 'message',
      id: 'w1',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'I need a local/ branch with an adjustment' }],
      },
    });

    const appId = sessionsDb.createAppSession('app-id-retitle', 'omp', cwd5, 'I need a local/');
    sessionsDb.assignProviderSessionId(appId, NATIVE);
    const synchronizer = new OmpSessionSynchronizer();

    await writeFile(jsonl5, [untitledSessionEntry, userEntry].join('\n') + '\n');
    await synchronizer.synchronizeFile(jsonl5);
    assert.equal(
      sessionsDb.getSessionByProviderSessionId(NATIVE)?.custom_name,
      'I need a local/',
      'the provisional app name must survive until omp writes a real title',
    );

    await writeFile(jsonl5, [
      JSON.stringify({ type: 'title', v: 1, title: 'Implement user turn navigation arrows', source: 'auto' }),
      sessionEntry,
      userEntry,
    ].join('\n') + '\n');
    getConnection().prepare(
      'UPDATE sessions SET name_source = NULL, provider_name = ? WHERE session_id = ?',
    ).run('Implement user turn navigation arrows', appId);
    await synchronizer.synchronizeFile(jsonl5);

    assert.equal(
      sessionsDb.getSessionByProviderSessionId(NATIVE)?.custom_name,
      'Implement user turn navigation arrows',
      'omp\'s title must replace the four-word name derived from the first app message',
    );

    sessionsDb.updateSessionCustomName(appId, 'I need a local/', 'user');
    await synchronizer.synchronizeFile(jsonl5);
    assert.equal(
      sessionsDb.getSessionByProviderSessionId(NATIVE)?.custom_name,
      'I need a local/',
      'an explicit app rename back to the provisional text must remain sticky',
    );

    closeConnection();
  });
  it('hides omp\'s internal developer-role system reminders', async () => {
    const { closeConnection, initializeDatabase } = await import('@/modules/database/index.js');
    const { OmpSessionSynchronizer } = await import('@/modules/providers/list/omp/omp-session-synchronizer.provider.js');
    const { OmpSessionsProvider } = await import('@/modules/providers/list/omp/omp-sessions.provider.js');

    closeConnection();
    await initializeDatabase();

    const NATIVE = 'devremindersess05';
    const cwd5 = '/work/omp-dev';
    const slugDir = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-dev');
    await mkdir(slugDir, { recursive: true });
    const jsonl5 = path.join(slugDir, `2026-07-21T03-00-00-000Z_${NATIVE}.jsonl`);
    await writeFile(jsonl5, [
      JSON.stringify({ type: 'session', version: 3, id: NATIVE, timestamp: '2026-07-21T03:00:00.000Z', cwd: cwd5 }),
      JSON.stringify({ type: 'title', v: 1, title: 'Dev', source: 'auto' }),
      JSON.stringify({ type: 'message', id: 't1', message: { role: 'assistant', content: [
        { type: 'toolCall', id: 'td1', name: 'todo_write', arguments: {
          agent__intent: 'Plan',
          ops: [{ op: 'replace', phases: [
            { name: 'Setup', tasks: [{ content: 'do the thing', status: 'pending' }] },
          ] }],
        } },
      ] } }),
      JSON.stringify({ type: 'message', id: 't2', message: { role: 'toolResult', toolCallId: 'td1', toolName: 'todo_write',
        content: [{ type: 'text', text: 'Overall: 0/1' }],
        details: { phases: [{ name: 'Setup', tasks: [{ content: 'do the thing', status: 'in_progress' }] }] } } }),
      // omp's internal continuity nudge — must NOT appear in the transcript
      JSON.stringify({ type: 'message', id: 'd1', message: { role: 'developer', attribution: 'agent',
        content: [{ type: 'text', text: '<system-reminder>\nYou stopped with 1 incomplete todo item(s):\n- Setup\n</system-reminder>' }] } }),
    ].join('\n') + '\n');

    await new OmpSessionSynchronizer().synchronizeFile(jsonl5);
    const all = await new OmpSessionsProvider().fetchHistory(NATIVE, {});

    assert.ok(
      all.messages.every((m) => !(m.content ?? '').includes('system-reminder')),
      'developer-role <system-reminder> messages are hidden',
    );

    const todo = all.messages.find((message) => message.kind === 'tool_use' && message.toolId === 'td1')!;
    assert.equal(todo.toolName, 'TodoWrite');
    assert.deepEqual(todo.toolInput, {
      todos: [{ content: 'do the thing', status: 'in_progress', phase: 'Setup' }],
    });
    assert.equal(todo.toolResult?.content, 'Overall: 0/1');

    closeConnection();
  });

  it('normalizes live OMP tools without cross-session todo correlation', async () => {
    const { OmpSessionsProvider } = await import('@/modules/providers/list/omp/omp-sessions.provider.js');
    const provider = new OmpSessionsProvider();

    const todoCall = provider.normalizeMessage({ update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'shared-id',
      title: 'Updating plan',
      rawInput: { op: 'init', list: [{ phase: 'Test', items: ['exercise path'] }] },
    } }, 'session-a')[0];
    assert.equal(todoCall.toolName, 'TodoWrite');

    const unrelatedCall = provider.normalizeMessage({ update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'shared-id',
      title: 'Searching',
      rawInput: { query: 'needle' },
    } }, 'session-b')[0];
    assert.equal(unrelatedCall.toolName, 'Searching');

    const unrelatedResult = provider.normalizeMessage({ update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'shared-id',
      status: 'completed',
      content: [{ type: 'text', text: 'plain output' }],
      rawOutput: { details: { phases: [{ name: 'Wrong', tasks: [{ content: 'wrong', status: 'pending' }] }] } },
    } }, 'session-b')[0];
    assert.equal(unrelatedResult.content, 'plain output');
    assert.deepEqual(unrelatedResult.toolUseResult, {
      phases: [{ name: 'Wrong', tasks: [{ content: 'wrong', status: 'pending' }] }],
    });

    const todoResult = provider.normalizeMessage({ update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'shared-id',
      status: 'completed',
      content: [{ type: 'text', text: 'done' }],
      rawOutput: { details: { phases: [{ name: 'Test', tasks: [{ content: 'exercise path', status: 'completed' }] }] } },
    } }, 'session-a')[0];
    assert.deepEqual(todoResult.toolUseResult, {
      todos: [{ content: 'exercise path', status: 'completed', phase: 'Test' }],
    });

    const bash = provider.normalizeMessage({ update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'bash-live',
      title: '$ printf ok',
      rawInput: { command: 'printf ok' },
    } }, 'session-a')[0];
    assert.equal(bash.toolName, 'Bash');
    assert.deepEqual(bash.toolInput, {
      command: 'printf ok',
      cwd: undefined,
      timeout: undefined,
    });

    const evaluation = provider.normalizeMessage({ update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'eval-live',
      title: 'Run Python',
      rawInput: { language: 'py', title: 'Count rows', code: 'print(3)' },
    } }, 'session-a')[0];
    assert.equal(evaluation.toolName, 'eval');
  });

  it('preserves rich OMP history through canonical tools and status notes', async () => {
    const { closeConnection, initializeDatabase } = await import('@/modules/database/index.js');
    const { OmpSessionSynchronizer } = await import('@/modules/providers/list/omp/omp-session-synchronizer.provider.js');
    const { OmpSessionsProvider } = await import('@/modules/providers/list/omp/omp-sessions.provider.js');

    closeConnection();
    await initializeDatabase();

    const nativeId = 'richhistorysess06';
    const slugDirectory = path.join(tempHome, '.omp', 'agent', 'sessions', '-work-omp-rich');
    await mkdir(slugDirectory, { recursive: true });
    const historyPath = path.join(slugDirectory, `2026-07-21T04-00-00-000Z_${nativeId}.jsonl`);
    const imageHash = '0123456789abcdef0123456789abcdef';
    const blobDirectory = path.join(tempHome, '.omp', 'agent', 'blobs');
    await mkdir(blobDirectory, { recursive: true });
    await writeFile(path.join(blobDirectory, imageHash), Buffer.from('image bytes'));

    await writeFile(historyPath, [
      JSON.stringify({ type: 'session', version: 3, id: nativeId, timestamp: '2026-07-21T04:00:00.000Z', cwd: '/work/omp-rich' }),
      JSON.stringify({ type: 'message', id: 'user', parentId: null, timestamp: '2026-07-21T04:00:01.000Z', message: { role: 'user', content: [
        { type: 'text', text: 'inspect this' },
        { type: 'image', data: `blob:sha256:${imageHash}`, mimeType: 'image/png' },
      ] } }),
      JSON.stringify({ type: 'message', id: 'tools', parentId: 'user', timestamp: '2026-07-21T04:00:02.000Z', message: { role: 'assistant', content: [
        { type: 'toolCall', id: 'bash-1', name: 'bash', arguments: { i: 'List files', command: 'ls' } },
        { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: '/tmp/file.txt' } },
        { type: 'toolCall', id: 'virtual-1', name: 'read', arguments: { path: 'memory://note' } },
        { type: 'toolCall', id: 'ask-1', name: 'ask', arguments: { questions: [
          { id: 'choice', question: 'Pick one', options: [{ label: 'Pause, prune, restart' }] },
        ] } },
      ] } }),
      JSON.stringify({ type: 'message', id: 'ask-result', parentId: 'tools', timestamp: '2026-07-21T04:00:03.000Z', message: {
        role: 'toolResult',
        toolCallId: 'ask-1',
        toolName: 'ask',
        content: [{ type: 'text', text: 'User selected: Pause, prune, restart' }],
        details: { question: 'Pick one', selectedOptions: ['Pause, prune, restart'] },
      } }),
      JSON.stringify({ type: 'custom_message', customType: 'collab-prompt', id: 'collab', parentId: 'ask-result',
        timestamp: '2026-07-21T04:00:04.000Z', content: 'continue', details: { from: 'guest' } }),
      JSON.stringify({ type: 'custom_message', customType: 'advisor', id: 'advisor-main', parentId: 'collab',
        timestamp: '2026-07-21T04:00:05.000Z',
        details: { advisor: 'luna', severity: 'concern', note: 'mind the cleanup' } }),
    ].join('\n') + '\n');

    const sidecarDirectory = historyPath.replace(/\.jsonl$/, '');
    await mkdir(sidecarDirectory, { recursive: true });
    await writeFile(path.join(sidecarDirectory, '__advisor.luna.jsonl'), [
      JSON.stringify({ type: 'message', id: 'sidecar-1', parentId: null, timestamp: '2026-07-21T04:00:05.000Z', message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'adv-1', name: 'advise', arguments: {
          note: 'mind the cleanup',
          severity: 'concern',
        } }],
      } }),
      JSON.stringify({ type: 'message', id: 'sidecar-2', parentId: 'sidecar-1', timestamp: '2026-07-21T04:00:06.000Z', message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'adv-2', name: 'advise', arguments: {
          note: 'verify the result',
          severity: 'nit',
        } }],
      } }),
    ].join('\n') + '\n');

    await new OmpSessionSynchronizer().synchronizeFile(historyPath);
    const history = await new OmpSessionsProvider().fetchHistory(nativeId, {});

    const bash = history.messages.find((message) => message.toolId === 'bash-1')!;
    assert.equal(bash.toolName, 'Bash');
    assert.deepEqual(bash.toolInput, {
      command: 'ls',
      cwd: undefined,
      timeout: undefined,
      description: 'List files',
    });
    assert.equal(history.messages.find((message) => message.toolId === 'read-1')?.toolName, 'Read');
    assert.equal(history.messages.find((message) => message.toolId === 'virtual-1')?.toolName, 'read');

    const ask = history.messages.find((message) => message.toolId === 'ask-1')!;
    assert.equal(ask.toolName, 'AskUserQuestion');
    assert.ok(ask.toolInput && typeof ask.toolInput === 'object' && 'answers' in ask.toolInput);
    assert.deepEqual(ask.toolInput.answers, {
      'Pick one': 'Pause, prune, restart',
    });

    const user = history.messages.find((message) => message.id === 'user_t0')!;
    assert.ok(Array.isArray(user.images));
    const firstImage = user.images[0];
    assert.ok(firstImage && typeof firstImage === 'object' && 'data' in firstImage);
    assert.equal(typeof firstImage.data === 'string' && firstImage.data.startsWith('data:image/png;base64,'), true);
    assert.equal(history.messages.find((message) => message.id === 'collab')?.content, 'guest: continue');

    const advisors = history.messages.filter((message) => message.kind === 'task_notification');
    assert.deepEqual(advisors.map((message) => [message.status, message.summary]), [
      ['concern', 'Advisor luna (concern): mind the cleanup'],
      ['nit', 'Advisor luna (nit): verify the result'],
    ]);

    closeConnection();
  });
});
