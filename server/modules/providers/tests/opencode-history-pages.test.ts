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
  runTest: (provider: OpenCodeSessionsProvider) => Promise<void>,
): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-history-pages-'));
  const originalHomedir = os.homedir;
  (os as any).homedir = () => homeDir;

  try {
    const dataDir = path.join(homeDir, '.local', 'share', 'opencode');
    await mkdir(dataDir, { recursive: true });
    const db = new Database(path.join(dataDir, 'opencode.db'));
    try {
      db.exec(OPENCODE_SCHEMA);
      db.transaction(() => seed(db))();
    } finally {
      db.close();
    }

    await runTest(new OpenCodeSessionsProvider());
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

/**
 * Seeds one session with every row shape the history reader handles: shown
 * and hidden parts of each type, messages without parts, shown and stopped
 * errors, malformed JSON, missing timestamps, ties broken by id, subagent
 * calls, and rows of other sessions that must not leak in.
 */
const seedRandomSession = (
  db: Database.Database,
  sessionId: string,
  seed: number,
  messageCount: number,
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
    const messageData = role === 'user'
      ? pick([json({ role: 'user' }), json({ role: ' user ' }), '[1,2]', '{"role":"user",'])
      : pick([
        json({ role: 'assistant', tokens: { input: 3, output: 2, reasoning: 1, cache: { read: 4, write: 1 } } }),
        json({ role: 'assistant', tokens: { input: 1, output: 1 } }),
        json({ role: 'assistant', error: { name: 'APIError', data: { message: `Rate limited ${index}` } } }),
        json({ role: ' assistant ', error: `plain failure ${index}` }),
        json({ role: 'assistant', error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } }),
        json({ role: 'assistant', error: null }),
        json({ role: 'assistant', error: 0 }),
        '{"role":"assistant","error":',
        Buffer.from(json({ role: 'assistant', error: 'stored as a blob' })),
      ]);
    insertMessage.run(messageId, sessionId, tick(), messageData);

    const partCount = pick([0, 0, 1, 1, 2, 3, 4]);
    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const callID = nextId('call');
      const prompt = `Prompt ${index}.${partIndex}`;
      const shapes: unknown[] = [
        json({ type: 'text', text: role === 'user' ? prompt : `Answer ${index}.${partIndex}` }),
        json({ type: 'text', text: JSON.stringify(prompt) }),
        json({ type: 'text', text: appendImagesInputTag(prompt, [{ path: `/assets/${index}.png`, name: 'shot.png' }]) }),
        json({ type: 'text', text: appendFilesInputTag(prompt, [{ path: `/assets/${index}.txt`, name: 'notes.txt' }]) }),
        json({ type: 'text', text: appendImagesInputTag('', [{ path: `/assets/only-${index}.png` }]) }),
        json({ type: 'text', text: '' }),
        json({ type: 'text', text: '   ' }),
        json({ type: 'text', text: '"   "' }),
        json({ type: 'text', content: `Content ${index}` }),
        json({ type: ' text ', text: `Padded ${index}` }),
        json({ type: 'reasoning', text: `Thinking ${index}` }),
        json({ type: 'reasoning', text: ' ' }),
        json({ type: 'tool', tool: 'bash', callID, state: { status: 'completed', input: { command: 'ls' }, output: `out ${index}` } }),
        json({ type: 'tool', tool: 'read', state: { status: 'error', input: {}, error: 'File not found' } }),
        json({ type: 'tool', tool: 'glob', callID, state: { status: 'running', input: { pattern: '*' } } }),
        json({ type: 'tool', tool: 'question', callID, state: QUESTION_STATE }),
        json({
          type: 'tool',
          tool: 'task',
          callID,
          state: {
            status: pick(['completed', 'running']),
            input: { description: 'Look around', subagent_type: 'general' },
            output: '<task id="x" state="completed">\n<task_result>\ndone\n</task_result>\n</task>',
            metadata: { sessionId: `${sessionId}_child`, model: { modelID: 'm' } },
          },
        }),
        json({ type: ' tool ', tool: 'bash', state: { status: 'completed', output: 'padded' } }),
        json({ type: 'step-start', snapshot: 'abc' }),
        json({ type: 'step-finish', reason: 'stop', tokens: { input: 1 } }),
        json({ type: 'patch', hash: 'h', files: ['a.ts'] }),
        json({ type: 'agent', name: 'general' }),
        json({ type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA' }),
        json({ type: 'snapshot', snapshot: 'abc' }),
        json({ type: 7 }),
        json({ text: 'no type' }),
        '[1,2]',
        '{"type":"tool",',
        null,
        Buffer.from(json({ type: 'tool', tool: 'bash' })),
      ];
      // User messages mostly carry prompts: the text shapes come first.
      const partData = pick(role === 'user' && random() < 0.8 ? shapes.slice(0, 10) : shapes);
      insertPart.run(nextId('prt'), messageId, sessionId, tick(), partData);
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

test('OpenCode history pages are exactly the matching slices of the full history', { concurrency: false }, async (t) => {
  // Rows without a timestamp are stamped with the current time.
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });

  await withOpenCodeDatabase((db) => {
    seedRandomSession(db, 'ses_a', 1, 90);
    seedRandomSession(db, 'ses_b', 2, 40);
    seedRandomSession(db, 'ses_c', 3, 7);
    db.prepare('UPDATE session SET tokens_input = 11, tokens_output = 5 WHERE id = ?').run('ses_b');
    // A part with an empty id counts as no part, but still names its message's error.
    db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)')
      .run('msg_empty_part', 'ses_c', 1_700_000_000_500, JSON.stringify({ role: 'assistant', error: 'failed' }));
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)')
      .run('', 'msg_empty_part', 'ses_c', 1_700_000_000_500, JSON.stringify({ type: 'text', text: 'hidden' }));
    db.prepare('INSERT INTO session (id) VALUES (?)').run('ses_empty');
  }, async (provider) => {
    for (const providerSessionId of ['ses_a', 'ses_b', 'ses_c', 'ses_empty', 'ses_missing']) {
      const full = await provider.fetchHistory('app-session', { providerSessionId });
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
    const kinds = new Set(full.messages.map((message) => message.kind));
    assert.deepEqual([...kinds].sort(), ['error', 'stream_end', 'text', 'thinking', 'tool_use']);
    assert.ok(full.messages.some((message) => message.subagent), 'task calls become subagents');
    assert.ok(full.messages.some((message) => message.images), 'user attachments are surfaced');
    // A message without parts is keyed by its position in the full history.
    assert.ok(full.messages.some((message) => /^msg_[0-9a-f]{8}_\d+_error$/.test(message.id)));
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
