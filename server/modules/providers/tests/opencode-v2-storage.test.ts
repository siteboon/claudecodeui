import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { OpenCodeProviderModels } from '@/modules/providers/list/opencode/opencode-models.provider.js';
import { OpenCodeSessionSynchronizer } from '@/modules/providers/list/opencode/opencode-session-synchronizer.provider.js';
import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';
import { createProviderTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';
import { subagentTurn, toolTurn } from '@/modules/providers/tests/fixtures/opencode-v2-run-lines.js';
import { OPENCODE_2_SCHEMA, OPENCODE_UPGRADED_SCHEMA } from '@/modules/providers/tests/fixtures/opencode-v2-schema.js';
import { appendFilesInputTag } from '@/shared/image-attachments.js';

/**
 * OpenCode 2.x keeps sessions in `session_v2` and messages in `session_message`
 * (and `session_part`). These tests build `opencode.db` with the tables real
 * OpenCode created (tests/fixtures/opencode-v2-schema.ts), fill them with rows
 * in the shapes 2.2.3 writes, and read them through the OpenCode synchronizer,
 * sessions provider, models provider and token usage service.
 */

type Home = { homeDir: string; db: Database.Database; workspace: string };

/** Runs one case with a throwaway CloudCLI database and an OpenCode home whose opencode.db has `schema`. */
async function withOpenCodeHome(schema: string, runTest: (home: Home) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-v2-storage-'));
  const originalHomedir = os.homedir;
  closeConnection();
  process.env.DATABASE_PATH = path.join(homeDir, 'auth.db');
  await initializeDatabase();
  (os as any).homedir = () => homeDir;

  const dataDir = path.join(homeDir, '.local', 'share', 'opencode');
  await mkdir(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'opencode.db'));
  db.exec(schema);
  const workspace = path.join(homeDir, 'work', 'app');
  db.prepare(`
    INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('prj', ?, 1, 1, '[]')
  `).run(workspace);

  try {
    await runTest({ homeDir, db, workspace });
  } finally {
    db.close();
    (os as any).homedir = originalHomedir;
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(homeDir, { recursive: true, force: true });
  }
}

type V2Session = {
  id: string;
  directory: string;
  timeUpdated: number;
  title?: string | null;
  parentId?: string | null;
  archivedAt?: number | null;
  model?: string | null;
  tokens?: [number, number, number, number, number];
};

const insertV2Session = (db: Database.Database, session: V2Session) => {
  const [input, output, reasoning, cacheRead, cacheWrite] = session.tokens ?? [0, 0, 0, 0, 0];
  db.prepare(`
    INSERT INTO session_v2 (
      id, project_id, parent_id, slug, directory, title, version, model, time_created, time_updated, time_archived,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write
    ) VALUES (?, 'prj', ?, ?, ?, ?, '2.2.3', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id, session.parentId ?? null, session.id, session.directory, session.title ?? null, session.model ?? null,
    session.timeUpdated - 100, session.timeUpdated, session.archivedAt ?? null,
    input, output, reasoning, cacheRead, cacheWrite,
  );
};

const insertV2Message = (
  db: Database.Database,
  sessionId: string,
  seq: number,
  id: string,
  type: string,
  data: Record<string, unknown>,
) => {
  const created = 1_793_723_500_000 + seq * 1000;
  db.prepare(`
    INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, type, seq, created, created, JSON.stringify({ time: { created }, ...data }));
};

const insertV1Session = (db: Database.Database, id: string, directory: string, timeUpdated: number, text: string) => {
  db.prepare(`
    INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
    VALUES (?, 'prj', ?, ?, 'New session - 1.x', '1.18.25', ?, ?)
  `).run(id, id, directory, timeUpdated - 100, timeUpdated);
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
    .run(`${id}_msg`, id, timeUpdated - 50, timeUpdated - 50, JSON.stringify({ role: 'assistant', time: { created: timeUpdated - 50 } }));
  db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(`${id}_prt`, `${id}_msg`, id, timeUpdated - 40, timeUpdated - 40, JSON.stringify({ type: 'text', text }));
};

const shellCall = (id: string, output: string) => ({
  type: 'tool',
  id,
  name: 'shell',
  executed: false,
  state: {
    status: 'completed',
    input: { command: 'npm test', description: 'Run the tests' },
    content: [{ type: 'text', text: output }],
    metadata: { status: 'completed', truncated: false, exit: 0 },
  },
  time: { created: 1_793_723_504_100, ran: 1_793_723_504_200, completed: 1_793_723_504_300 },
});

const summarize = (messages: Array<Record<string, any>>) => messages.map((message) => {
  if (message.kind === 'tool_use') {
    return `tool:${message.toolName}:${message.toolId}:${message.toolResult?.isError ? 'error' : 'ok'}`;
  }
  if (message.kind === 'text') {
    return `${message.role}:${message.content}`;
  }
  return message.kind === 'stream_end' ? 'end' : `${message.kind}:${message.content}`;
});

test('the synchronizer indexes 2.x sessions from session_v2, without subagent or archived ones', { concurrency: false }, async () => {
  await withOpenCodeHome(OPENCODE_2_SCHEMA, async ({ db, workspace }) => {
    insertV2Session(db, { id: 'ses_top', directory: workspace, timeUpdated: 1_793_723_510_000 });
    insertV2Message(db, 'ses_top', 1, 'msg_top_user', 'user', { text: 'Build the "thing" now', files: [] });
    insertV2Session(db, { id: 'ses_titled', directory: workspace, timeUpdated: 1_793_723_520_000, title: 'OpenCode title' });
    insertV2Session(db, { id: 'ses_child', directory: workspace, timeUpdated: 1_793_723_530_000, parentId: 'ses_top' });
    insertV2Session(db, { id: 'ses_archived', directory: workspace, timeUpdated: 1_793_723_540_000, archivedAt: 1_793_723_541_000 });

    const processed = await new OpenCodeSessionSynchronizer().synchronize();

    assert.equal(processed, 2);
    const top = sessionsDb.getSessionByProviderSessionId('ses_top');
    // Titled by its first prompt.
    assert.equal(top?.custom_name, 'Build the "thing" now');
    assert.equal(top?.project_path, workspace);
    assert.equal(sessionsDb.getSessionByProviderSessionId('ses_titled')?.custom_name, 'OpenCode title');
    assert.equal(sessionsDb.getSessionByProviderSessionId('ses_child'), null);
    assert.equal(sessionsDb.getSessionByProviderSessionId('ses_archived'), null);
  });
});

test('2.x history shows prompts, answers, thinking and tool cards, without bookkeeping or a stopped turn\'s error', { concurrency: false }, async () => {
  await withOpenCodeHome(OPENCODE_2_SCHEMA, async ({ db, workspace }) => {
    insertV2Session(db, { id: 'ses_hist', directory: workspace, timeUpdated: 1_793_723_590_000, tokens: [100, 20, 5, 30, 4] });
    const prompt = appendFilesInputTag('Look at "this" file', [{ path: `${workspace}/brief.pdf`, name: 'brief.pdf' }]);
    insertV2Message(db, 'ses_hist', 1, 'msg_switch', 'agent-switched', { agent: 'build' });
    insertV2Message(db, 'ses_hist', 2, 'msg_reminder', 'synthetic', { text: '<system-reminder>Plan mode</system-reminder>' });
    insertV2Message(db, 'ses_hist', 3, 'msg_user', 'user', { text: prompt, files: [] });
    insertV2Message(db, 'ses_hist', 4, 'msg_step_1', 'assistant', {
      agent: 'build',
      model: { id: 'gpt-5.6-terra', providerID: 'github-copilot' },
      content: [
        { type: 'reasoning', text: 'Checking the tests first.' },
        { type: 'text', text: 'Running the tests.' },
        shellCall('call_shell', 'all green\n'),
        {
          type: 'tool',
          id: 'call_edit',
          name: 'edit',
          state: {
            status: 'error',
            input: { path: `${workspace}/a.ts`, oldString: 'a', newString: 'b' },
            error: { type: 'permission.rejected', message: 'This non-interactive run cannot ask the user for permission.' },
          },
          time: { created: 1_793_723_504_400 },
        },
      ],
      finish: 'tool-calls',
    });
    insertV2Message(db, 'ses_hist', 5, 'msg_stopped', 'assistant', {
      content: [{ type: 'text', text: 'Half an answer' }],
      error: { type: 'aborted', message: 'Step interrupted' },
      finish: 'error',
    });
    insertV2Message(db, 'ses_hist', 6, 'msg_idle', 'idle', { outcome: 'interrupted' });
    insertV2Message(db, 'ses_hist', 7, 'msg_system', 'system', { text: 'The `bash` tool is now `shell`.' });
    insertV2Message(db, 'ses_hist', 8, 'msg_failed', 'assistant', {
      content: [],
      error: { type: 'provider.no-route', message: 'Model unavailable: x/y' },
      finish: 'error',
    });

    const history = await new OpenCodeSessionsProvider().fetchHistory('app-hist', { providerSessionId: 'ses_hist' });

    assert.deepEqual(summarize(history.messages), [
      'user:Look at "this" file',
      'thinking:Checking the tests first.',
      'assistant:Running the tests.',
      'tool:bash:call_shell:ok',
      'tool:edit:call_edit:error',
      'end',
      'assistant:Half an answer',
      'end',
      'error:Model unavailable: x/y',
      'end',
    ]);
    const [user] = history.messages as Array<Record<string, any>>;
    assert.deepEqual(user.files?.map((file: { name?: string }) => file.name), ['brief.pdf']);
    const shell = history.messages.find((message) => message.toolId === 'call_shell') as Record<string, any>;
    assert.deepEqual(shell.toolInput, { command: 'npm test', description: 'Run the tests' });
    assert.equal(shell.toolResult.content, 'all green\n');
    const edit = history.messages.find((message) => message.toolId === 'call_edit') as Record<string, any>;
    assert.match(edit.toolResult.content, /cannot ask the user for permission/);
    assert.equal(history.total, 10);
    assert.deepEqual(history.tokenUsage, { used: 159, inputTokens: 130, outputTokens: 20, breakdown: { input: 130, output: 20 } });

    const lastPage = await new OpenCodeSessionsProvider().fetchHistory('app-hist', { providerSessionId: 'ses_hist', limit: 2, offset: 0 });
    assert.deepEqual(summarize(lastPage.messages), ['error:Model unavailable: x/y', 'end']);
    assert.equal(lastPage.hasMore, true);
  });
});

test('an assistant message whose content OpenCode keeps in session_part is read from there', { concurrency: false }, async () => {
  await withOpenCodeHome(OPENCODE_2_SCHEMA, async ({ db, workspace }) => {
    insertV2Session(db, { id: 'ses_parts', directory: workspace, timeUpdated: 1_793_723_590_000 });
    insertV2Message(db, 'ses_parts', 1, 'msg_parts', 'assistant', { content: [], finish: 'stop' });
    const insertPart = db.prepare(`
      INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data)
      VALUES ('msg_parts', 'ses_parts', ?, ?, ?, 1, 1, ?)
    `);
    insertPart.run(1, 'tool', 'call_from_part', JSON.stringify(shellCall('call_from_part', 'from a part')));
    insertPart.run(0, 'text', null, JSON.stringify({ type: 'text', text: 'Kept in session_part.' }));

    const history = await new OpenCodeSessionsProvider().fetchHistory('ses_parts');

    assert.deepEqual(summarize(history.messages), ['assistant:Kept in session_part.', 'tool:bash:call_from_part:ok', 'end']);
  });
});

test('a 2.x tool call keeps its id from the live row to the history, so a reload does not show it twice', { concurrency: false }, async () => {
  await withOpenCodeHome(OPENCODE_2_SCHEMA, async ({ db, workspace }) => {
    const live = new OpenCodeSessionsProvider().normalizeMessage(toolTurn[1], 'app-live')[0] as Record<string, any>;
    assert.equal(live.toolName, 'bash');
    assert.equal(live.toolId, 'call_fake_5');

    // The same call as OpenCode stored it.
    const sessionId = toolTurn[1].sessionID as string;
    const messageId = toolTurn[1].part.messageID as string;
    insertV2Session(db, { id: sessionId, directory: workspace, timeUpdated: 1_793_723_590_000 });
    insertV2Message(db, sessionId, 1, messageId, 'assistant', {
      content: [{ ...shellCall('call_fake_5', 'hello-from-fake-tool\n'), name: 'shell' }],
      finish: 'tool-calls',
    });
    const stored = (await new OpenCodeSessionsProvider().fetchHistory(sessionId)).messages[0] as Record<string, any>;

    assert.equal(stored.id, live.id);
    assert.equal(stored.toolId, live.toolId);
    assert.equal(stored.toolName, live.toolName);
  });
});

test('a 2.x subagent call shows as the subagent card with its child session, live and in history', { concurrency: false }, async () => {
  await withOpenCodeHome(OPENCODE_2_SCHEMA, async ({ db, workspace }) => {
    const parentId = subagentTurn[1].sessionID as string;
    const childId = 'ses_e5da1e45fffeZ2WCwgpM9byvoB';
    insertV2Session(db, { id: parentId, directory: workspace, timeUpdated: 1_793_723_590_000 });
    insertV2Session(db, { id: childId, directory: workspace, timeUpdated: 1_793_723_580_000, parentId });
    insertV2Message(db, childId, 1, 'msg_child_user', 'user', { text: 'You are a subagent spawned by another session.\nSay hello' });
    insertV2Message(db, childId, 2, 'msg_child_reply', 'assistant', {
      content: [shellCall('call_child', 'hi\n'), { type: 'text', text: 'Hello from the fake model.' }],
      finish: 'stop',
    });

    const assertSubagentCard = (card: Record<string, any>) => {
      assert.equal(card.toolName, 'task');
      assert.equal(card.toolId, 'call_fake_2');
      assert.equal(card.toolInput.subagent_type, 'general');
      // The `<subagent …>` wrapper is not part of the answer.
      assert.equal(card.toolResult.content, 'Hello from the fake model.');
      assert.equal(card.subagent.id, childId);
      assert.equal(card.subagent.type, 'general');
      assert.equal(card.subagent.description, 'Say hi in a subagent');
      assert.equal(card.subagent.status, 'completed');
      assert.deepEqual(card.subagentTools.map((step: Record<string, any>) => `${step.kind}:${step.toolName ?? step.content}`), [
        'tool:bash',
        'text:Hello from the fake model.',
      ]);
    };

    assertSubagentCard(new OpenCodeSessionsProvider().normalizeMessage(subagentTurn[1], 'app-parent')[0] as Record<string, any>);

    const livePart = subagentTurn[1].part;
    insertV2Message(db, parentId, 1, livePart.messageID, 'assistant', {
      content: [{
        type: 'tool',
        id: livePart.id,
        name: 'subagent',
        state: {
          status: 'completed',
          input: livePart.state.input,
          content: livePart.state.metadata.content,
          metadata: livePart.state.metadata.metadata,
        },
        time: { created: 1_793_723_504_100 },
      }],
      finish: 'tool-calls',
    });
    const history = await new OpenCodeSessionsProvider().fetchHistory(parentId);
    assertSubagentCard(history.messages[0] as Record<string, any>);
  });
});

test('an upgraded database lists each session once, and a 1.x CLI writing it again makes the 1.x tables live', { concurrency: false }, async () => {
  await withOpenCodeHome(OPENCODE_UPGRADED_SCHEMA, async ({ db, workspace }) => {
    // 2.x migrated the 1.x session into session_v2 and left the 1.x rows behind.
    insertV1Session(db, 'ses_v1', workspace, 1_793_723_510_000, 'answer kept in the 1.x tables');
    insertV2Session(db, { id: 'ses_v1', directory: workspace, timeUpdated: 1_793_723_510_000 });
    insertV2Message(db, 'ses_v1', 0, 'msg_v1_user', 'user', { text: 'migrated prompt' });
    insertV2Message(db, 'ses_v1', 1, 'ses_v1_msg', 'assistant', { content: [{ type: 'text', text: 'migrated answer' }], finish: 'stop' });
    insertV2Session(db, { id: 'ses_v2', directory: workspace, timeUpdated: 1_793_723_520_000 });

    const synchronizer = new OpenCodeSessionSynchronizer();
    assert.equal(await synchronizer.synchronize(), 2);
    assert.ok(sessionsDb.getSessionByProviderSessionId('ses_v1'));
    assert.ok(sessionsDb.getSessionByProviderSessionId('ses_v2'));
    const provider = new OpenCodeSessionsProvider();
    assert.deepEqual(summarize((await provider.fetchHistory('ses_v1')).messages), [
      'user:migrated prompt',
      'assistant:migrated answer',
      'end',
    ]);

    // A downgraded 1.x CLI writes only the 1.x tables, and 2.x never imports that.
    insertV1Session(db, 'ses_after_downgrade', workspace, 1_793_723_530_000, 'written by 1.x again');
    await synchronizer.synchronize();
    assert.ok(sessionsDb.getSessionByProviderSessionId('ses_after_downgrade'));
    assert.deepEqual(summarize((await provider.fetchHistory('ses_after_downgrade')).messages), ['assistant:written by 1.x again']);

    // Back on 2.x, that session still has only its 1.x rows, and is read from them.
    insertV2Session(db, { id: 'ses_upgraded_again', directory: workspace, timeUpdated: 1_793_723_540_000 });
    assert.deepEqual(summarize((await provider.fetchHistory('ses_after_downgrade')).messages), ['assistant:written by 1.x again']);
    assert.deepEqual(summarize((await provider.fetchHistory('ses_v1')).messages), [
      'user:migrated prompt',
      'assistant:migrated answer',
      'end',
    ]);
  });
});

test('token usage and the model of a 2.x session come from session_v2', { concurrency: false }, async () => {
  await withOpenCodeHome(OPENCODE_2_SCHEMA, async ({ db, homeDir, workspace }) => {
    insertV2Session(db, {
      id: 'ses_usage',
      directory: workspace,
      timeUpdated: 1_793_723_590_000,
      model: JSON.stringify({ id: 'glm-5.3', providerID: 'zai', variant: 'high' }),
      tokens: [12, 7, 3, 5, 2],
    });

    const active = await new OpenCodeProviderModels(async () => []).getCurrentActiveModel('ses_usage');
    assert.equal(active.model, 'zai/glm-5.3');

    const service = createProviderTokenUsageService({
      getSessionById: () => ({
        session_id: 'app-usage',
        provider: 'opencode',
        provider_session_id: 'ses_usage',
        project_path: workspace,
        jsonl_path: null,
        custom_name: null,
        model: null,
        effort: null,
        forked_from_session_id: null,
        isArchived: 0,
        created_at: '2026-11-03T00:00:00.000Z',
        updated_at: '2026-11-03T00:00:00.000Z',
      }) as any,
      getOpenCodeDatabasePath: () => path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db'),
    });
    assert.deepEqual(await service.getSessionTokenUsage('app-usage'), {
      used: 29,
      inputTokens: 17,
      outputTokens: 7,
      breakdown: { input: 17, output: 7 },
    });
  });
});
