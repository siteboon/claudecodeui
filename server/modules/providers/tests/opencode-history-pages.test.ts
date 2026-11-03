import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';
import { appendFilesInputTag, appendImagesInputTag } from '@/shared/image-attachments.js';
import { sliceTailPage } from '@/shared/utils.js';

// opencode.db's message and part tables and their indexes, without the NOT NULL
// constraints, so rows with missing timestamps or data can be seeded too.
const OPENCODE_SCHEMA = `
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    tokens_input INTEGER NOT NULL DEFAULT 0,
    tokens_output INTEGER NOT NULL DEFAULT 0,
    tokens_reasoning INTEGER NOT NULL DEFAULT 0,
    tokens_cache_read INTEGER NOT NULL DEFAULT 0,
    tokens_cache_write INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
  CREATE TABLE part (
    id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT
  );
  CREATE INDEX message_session_time_created_id_idx ON message (session_id, time_created, id);
  CREATE INDEX part_message_id_id_idx ON part (message_id, id);
  CREATE INDEX part_session_idx ON part (session_id);
`;

async function withOpenCodeDatabase(
  seed: (db: Database.Database) => void,
  runTest: (provider: OpenCodeSessionsProvider, dbPath: string) => Promise<void>,
): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-history-pages-'));
  const originalHomedir = os.homedir;
  (os as any).homedir = () => homeDir;

  try {
    const dataDir = path.join(homeDir, '.local', 'share', 'opencode');
    await mkdir(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'opencode.db');
    const db = new Database(dbPath);
    try {
      db.exec(OPENCODE_SCHEMA);
      db.transaction(() => seed(db))();
    } finally {
      db.close();
    }

    await runTest(new OpenCodeSessionsProvider(), dbPath);
  } finally {
    (os as any).homedir = originalHomedir;
    await rm(homeDir, { recursive: true, force: true });
  }
}

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const QUESTION_STATE = {
  status: 'completed',
  input: { questions: [{ question: 'Which color?', header: 'Color', options: [{ label: 'Red', description: '' }] }] },
  output: 'User has answered your questions: "Which color?"="Red".',
  metadata: { answers: [['Red']] },
};

/** What the seeded rows must show: the messages whose error is shown, and each part's message kind. */
type SeededExpectations = {
  shownErrors: Set<string>;
  partKinds: Map<string, string | null>;
};

/**
 * Seeds one session with every row shape the history reader handles: shown
 * and hidden parts of each type, messages without parts, shown and stopped
 * errors, malformed JSON, missing timestamps, ties broken by id, subagent
 * calls, and rows of other sessions that must not leak in. Records what each
 * row must show in `expectations`.
 */
const seedRandomSession = (
  db: Database.Database,
  sessionId: string,
  seed: number,
  messageCount: number,
  expectations: SeededExpectations,
): void => {
  const random = createRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  // Ids that do not sort in insertion order, so equal timestamps are ordered by id.
  const nextId = (prefix: string) => `${prefix}_${Math.floor(random() * 0xffffffff).toString(16).padStart(8, '0')}`;
  const insertMessage = db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)');
  const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)');
  let clock = 1_700_000_000_000;
  const tick = (): number | null => {
    clock += pick([0, 0, 1, 7, 1000]);
    return pick([clock, clock, clock, clock, clock, clock, null, 0]);
  };
  const json = (value: unknown) => JSON.stringify(value);

  db.prepare('INSERT INTO session (id) VALUES (?)').run(sessionId);
  for (let index = 0; index < messageCount; index += 1) {
    const messageId = nextId('msg');
    const role = random() < 0.35 ? 'user' : 'assistant';
    // [data, whether the message shows an error, whether it reads as a user message]
    const [messageData, showsError, readsAsUser] = role === 'user'
      ? pick<[unknown, boolean, boolean]>([
        [json({ role: 'user' }), false, true],
        [json({ role: ' user ' }), false, true],
        ['[1,2]', false, false],
        ['{"role":"user",', false, false],
      ])
      : pick<[unknown, boolean, boolean]>([
        [json({ role: 'assistant', tokens: { input: 3, output: 2, reasoning: 1, cache: { read: 4, write: 1 } } }), false, false],
        [json({ role: 'assistant', tokens: { input: 1, output: 1 } }), false, false],
        [json({ role: 'assistant', error: { name: 'APIError', data: { message: `Rate limited ${index}` } } }), true, false],
        [json({ role: ' assistant ', error: `plain failure ${index}` }), true, false],
        [json({ role: 'assistant', error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } }), false, false],
        [json({ role: 'assistant', error: null }), false, false],
        [json({ role: 'assistant', error: 0 }), true, false],
        ['{"role":"assistant","error":', false, false],
        [Buffer.from(json({ role: 'assistant', error: 'stored as a blob' })), false, false],
      ]);
    insertMessage.run(messageId, sessionId, tick(), messageData);
    if (showsError) {
      expectations.shownErrors.add(messageId);
    }

    const partCount = pick([0, 0, 1, 1, 2, 3, 4]);
    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const callID = nextId('call');
      const prompt = `Prompt ${index}.${partIndex}`;
      // [data, the kind of message it shows, or null when it shows nothing]
      const shapes: [unknown, string | null][] = [
        [json({ type: 'text', text: role === 'user' ? prompt : `Answer ${index}.${partIndex}` }), 'text'],
        [json({ type: 'text', text: JSON.stringify(prompt) }), 'text'],
        [json({ type: 'text', text: appendImagesInputTag(prompt, [{ path: `/assets/${index}.png`, name: 'shot.png' }]) }), 'text'],
        [json({ type: 'text', text: appendFilesInputTag(prompt, [{ path: `/assets/${index}.txt`, name: 'notes.txt' }]) }), 'text'],
        [json({ type: 'text', text: appendImagesInputTag('', [{ path: `/assets/only-${index}.png` }]) }), 'text'],
        // An attachment block that names no file is all a user prompt holds; elsewhere it is text.
        [json({ type: 'text', text: '<images_input>\n</images_input>' }), readsAsUser ? null : 'text'],
        [json({ type: 'text', text: '<files_input>\nnothing listed\n</files_input>' }), readsAsUser ? null : 'text'],
        [json({ type: 'text', text: '' }), null],
        [json({ type: 'text', text: '   ' }), null],
        [json({ type: 'text', text: '"   "' }), null],
        [json({ type: 'text', content: `Content ${index}` }), 'text'],
        [json({ type: ' text ', text: `Padded ${index}` }), 'text'],
        [json({ type: 'reasoning', text: `Thinking ${index}` }), 'thinking'],
        [json({ type: 'reasoning', text: ' ' }), null],
        [json({ type: 'tool', tool: 'bash', callID, state: { status: 'completed', input: { command: 'ls' }, output: `out ${index}` } }), 'tool_use'],
        [json({ type: 'tool', tool: 'read', state: { status: 'error', input: {}, error: 'File not found' } }), 'tool_use'],
        [json({ type: 'tool', tool: 'glob', callID, state: { status: 'running', input: { pattern: '*' } } }), 'tool_use'],
        [json({ type: 'tool', tool: 'question', callID, state: QUESTION_STATE }), 'tool_use'],
        [json({
          type: 'tool',
          tool: 'task',
          callID,
          state: {
            status: pick(['completed', 'running']),
            input: { description: 'Look around', subagent_type: 'general' },
            output: '<task id="x" state="completed">\n<task_result>\ndone\n</task_result>\n</task>',
            metadata: { sessionId: `${sessionId}_child`, model: { modelID: 'm' } },
          },
        }), 'tool_use'],
        [json({ type: ' tool ', tool: 'bash', state: { status: 'completed', output: 'padded' } }), 'tool_use'],
        [json({ type: 'step-start', snapshot: 'abc' }), null],
        [json({ type: 'step-finish', reason: 'stop', tokens: { input: 1 } }), 'stream_end'],
        [json({ type: 'patch', hash: 'h', files: ['a.ts'] }), 'tool_use'],
        [json({ type: 'agent', name: 'general' }), 'tool_use'],
        [json({ type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA' }), null],
        [json({ type: 'snapshot', snapshot: 'abc' }), null],
        [json({ type: 7 }), null],
        [json({ text: 'no type' }), null],
        ['[1,2]', null],
        ['{"type":"tool",', null],
        [null, null],
        [Buffer.from(json({ type: 'tool', tool: 'bash' })), null],
      ];
      // User messages mostly carry prompts: the text shapes come first.
      const [partData, kind] = pick(role === 'user' && random() < 0.8 ? shapes.slice(0, 12) : shapes);
      const partId = nextId('prt');
      insertPart.run(partId, messageId, sessionId, tick(), partData);
      expectations.partKinds.set(partId, kind);
    }

    // Rows that share an id with this session but belong to another one.
    if (index % 9 === 0) {
      insertPart.run(nextId('prt'), messageId, `${sessionId}_other`, tick(), json({ type: 'text', text: 'other session' }));
      insertPart.run(nextId('prt'), `${messageId}_other`, sessionId, tick(), json({ type: 'text', text: 'other message' }));
    }
  }

  // The child session the task calls point at.
  const childMessageId = nextId('msg');
  insertMessage.run(childMessageId, `${sessionId}_child`, clock, json({ role: 'assistant' }));
  insertPart.run(nextId('prt'), childMessageId, `${sessionId}_child`, clock, json({ type: 'text', text: 'child step' }));
};

/**
 * The `id kind` list a session's full history must have: its rows in the
 * order of a `message LEFT JOIN part` sorted by message then part, each
 * showing its message's error on the message's first row, then its part. A
 * row without a part is keyed by how many messages came before it.
 */
const readExpectedHistory = (dbPath: string, sessionId: string, expectations: SeededExpectations): string[] => {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT m.id AS message_id, p.id AS part_id
      FROM message m
      LEFT JOIN part p ON p.session_id = m.session_id AND p.message_id = m.id
      WHERE m.session_id = ?
      ORDER BY COALESCE(m.time_created, 0), m.id, COALESCE(p.time_created, 0), p.id
    `).all(sessionId) as { message_id: string; part_id: string | null }[];

    const expected: string[] = [];
    let previousMessageId: string | null = null;
    for (const row of rows) {
      if (row.message_id !== previousMessageId && expectations.shownErrors.has(row.message_id)) {
        expected.push(`${row.message_id}_${row.part_id ?? expected.length}_error error`);
      }
      previousMessageId = row.message_id;

      const kind = row.part_id ? expectations.partKinds.get(row.part_id) : null;
      if (kind) {
        expected.push(`${row.message_id}_${row.part_id} ${kind}`);
      }
    }
    return expected;
  } finally {
    db.close();
  }
};

test('OpenCode history pages are exactly the matching slices of the full history', { concurrency: false }, async (t) => {
  // Rows without a timestamp are stamped with the current time.
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const expectations: SeededExpectations = { shownErrors: new Set(), partKinds: new Map() };

  await withOpenCodeDatabase((db) => {
    seedRandomSession(db, 'ses_a', 1, 90, expectations);
    seedRandomSession(db, 'ses_b', 2, 40, expectations);
    seedRandomSession(db, 'ses_c', 3, 7, expectations);
    db.prepare('UPDATE session SET tokens_input = 11, tokens_output = 5 WHERE id = ?').run('ses_b');
    // A part with an empty id counts as no part, but still names its message's error.
    db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)')
      .run('msg_empty_part', 'ses_c', 1_700_000_000_500, JSON.stringify({ role: 'assistant', error: 'failed' }));
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)')
      .run('', 'msg_empty_part', 'ses_c', 1_700_000_000_500, JSON.stringify({ type: 'text', text: 'hidden' }));
    expectations.shownErrors.add('msg_empty_part');
    // Rows the outline counts from its own reading of their JSON: a user
    // message's error (never shown), a `text` and a `content` that are not
    // strings (nothing shown), and JSON nested deeper than SQLite's json_valid
    // accepts, which only the JavaScript parser reads.
    const insertMessage = db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)');
    const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)');
    const deeplyNested = `${'['.repeat(1001)}${']'.repeat(1001)}`;
    insertMessage.run('msg_user_error', 'ses_c', 1_700_000_000_600, JSON.stringify({ role: 'user', error: 'not shown' }));
    insertPart.run('prt_text_object', 'msg_user_error', 'ses_c', 1_700_000_000_601, JSON.stringify({ type: 'text', text: { value: 'x' } }));
    expectations.partKinds.set('prt_text_object', null);
    insertPart.run('prt_content_array', 'msg_user_error', 'ses_c', 1_700_000_000_602, JSON.stringify({ type: 'text', content: [{ type: 'text', text: 'x' }] }));
    expectations.partKinds.set('prt_content_array', null);
    insertMessage.run('msg_deep', 'ses_c', 1_700_000_000_700, `{"role":"assistant","error":"deep failure","x":${deeplyNested}}`);
    expectations.shownErrors.add('msg_deep');
    insertPart.run('prt_deep_text', 'msg_deep', 'ses_c', 1_700_000_000_701, `{"type":"text","text":"deep text","x":${deeplyNested}}`);
    expectations.partKinds.set('prt_deep_text', 'text');
    db.prepare('INSERT INTO session (id) VALUES (?)').run('ses_empty');
  }, async (provider, dbPath) => {
    for (const providerSessionId of ['ses_a', 'ses_b', 'ses_c', 'ses_empty', 'ses_missing']) {
      const full = await provider.fetchHistory('app-session', { providerSessionId });
      assert.deepEqual(
        full.messages.map((message) => `${message.id} ${message.kind}`),
        readExpectedHistory(dbPath, providerSessionId, expectations),
        `${providerSessionId}: full history`,
      );
      assert.equal(full.total, full.messages.length, `${providerSessionId}: total counts every message`);
      assert.equal(full.hasMore, false);

      const { total } = full;
      const limits = [null, -1, 0, 1, 2, 3, 7, 20, total - 1, total, total + 5];
      const offsets = [-5, 0, 1, 2, 5, 19, total - 1, total, total + 3];
      for (const limit of limits) {
        for (const offset of offsets) {
          const expectedLimit = limit === null ? null : Math.max(0, limit);
          const expectedOffset = Math.max(0, offset);
          const expected = sliceTailPage(full.messages, expectedLimit, expectedOffset);
          const page = await provider.fetchHistory('app-session', { providerSessionId, limit, offset });

          assert.deepEqual(page, {
            messages: expected.page,
            total,
            hasMore: expected.hasMore,
            offset: expectedOffset,
            limit: expectedLimit,
            tokenUsage: full.tokenUsage,
          }, `${providerSessionId}: limit ${limit}, offset ${offset}`);
        }
      }
    }

    const full = await provider.fetchHistory('app-session', { providerSessionId: 'ses_a' });
    assert.ok(full.messages.some((message) => message.subagent), 'task calls become subagents');
    assert.ok(full.messages.some((message) => message.images), 'user attachments are surfaced');
    assert.ok(full.messages.some((message) => /^msg_[0-9a-f]{8}_\d+_error$/.test(message.id)), 'a part-less error is shown');
  });
});

test('an OpenCode history page reads tool output and subagent timelines only for the rows it shows', { concurrency: false }, async (t) => {
  const turns = 300;
  const stepsPerSubagent = 3;
  await withOpenCodeDatabase((db) => {
    const insertMessage = db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)');
    const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)');
    db.prepare('INSERT INTO session (id) VALUES (?)').run('ses_long');
    for (let turn = 0; turn < turns; turn += 1) {
      const turnId = String(turn).padStart(4, '0');
      const time = 1_700_000_000_000 + turn * 10;
      insertMessage.run(`msg_${turnId}_1`, 'ses_long', time, JSON.stringify({ role: 'user' }));
      insertPart.run(`prt_${turnId}_1`, `msg_${turnId}_1`, 'ses_long', time, JSON.stringify({ type: 'text', text: `Prompt ${turn}` }));

      insertMessage.run(`msg_${turnId}_2`, 'ses_long', time + 1, JSON.stringify({ role: 'assistant' }));
      // Every 25th turn, the last one included, delegates to a subagent.
      const childSessionId = turn % 25 === 24 ? `ses_child_${turnId}` : null;
      insertPart.run(`prt_${turnId}_2`, `msg_${turnId}_2`, 'ses_long', time + 1, JSON.stringify({
        type: 'tool',
        tool: childSessionId ? 'task' : 'bash',
        callID: `call_${turnId}`,
        state: {
          status: 'completed',
          input: { command: 'npm test' },
          output: `TOOL_OUTPUT_${turn} ${'x'.repeat(2000)}`,
          metadata: childSessionId ? { sessionId: childSessionId } : {},
        },
      }));
      if (childSessionId) {
        insertMessage.run(`msg_${turnId}_child`, childSessionId, time, JSON.stringify({ role: 'assistant' }));
        for (let step = 0; step < stepsPerSubagent; step += 1) {
          insertPart.run(`prt_${turnId}_child_${step}`, `msg_${turnId}_child`, childSessionId, time + step, JSON.stringify({
            type: 'text',
            text: `CHILD_STEP_${turn}_${step}`,
          }));
        }
      }

      insertMessage.run(`msg_${turnId}_3`, 'ses_long', time + 2, JSON.stringify({ role: 'assistant' }));
      insertPart.run(`prt_${turnId}_3`, `msg_${turnId}_3`, 'ses_long', time + 2, JSON.stringify({ type: 'text', text: `Answer ${turn}` }));
    }
  }, async (provider) => {
    const parse = t.mock.method(JSON, 'parse');
    const page = await provider.fetchHistory('app-session', { providerSessionId: 'ses_long', limit: 10, offset: 0 });
    const parsedInputs = parse.mock.calls.map((call) => String(call.arguments[0]));
    parse.mock.restore();

    assert.equal(page.total, turns * 3);
    assert.equal(page.hasMore, true);
    assert.deepEqual(page.messages.map((message) => message.content ?? message.toolName), [
      'Answer 296',
      'Prompt 297', 'bash', 'Answer 297',
      'Prompt 298', 'bash', 'Answer 298',
      'Prompt 299', 'task', 'Answer 299',
    ]);
    assert.equal(page.messages[8]?.subagent?.activityCount, stepsPerSubagent);

    // The 297 tool outputs and 11 subagent timelines older than the page are not read.
    const toolOutputsRead = parsedInputs.filter((input) => input.includes('TOOL_OUTPUT_')).length;
    const childStepsRead = parsedInputs.filter((input) => input.includes('CHILD_STEP_')).length;
    assert.equal(toolOutputsRead, 3);
    assert.equal(childStepsRead, stepsPerSubagent);
  });
});
