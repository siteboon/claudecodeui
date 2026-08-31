import assert from 'node:assert/strict';
import test from 'node:test';

import { HeldClaudeSession } from '@/modules/providers/list/claude/claude-held-session.js';

type Fingerprint = {
  cwd: string;
  mcp: string;
  effort: string;
  model: string;
  permissionMode: string;
  writer: unknown;
};

const writer = { name: 'writer' };

const fingerprint = (overrides: Partial<Fingerprint> = {}): Fingerprint => ({
  cwd: '/workspace',
  mcp: 'chrome-tabs',
  effort: 'high',
  model: 'opus',
  permissionMode: 'default',
  writer,
  ...overrides,
});

/**
 * Stands in for the SDK query: reads the prompt stream and answers every user
 * message with one assistant message and the `result` that ends the turn.
 */
function fakeQuery(session: HeldClaudeSession, seen: unknown[]) {
  const instance = (async function* () {
    for await (const message of session.promptStream()) {
      seen.push(message);
      yield { type: 'assistant', text: 'answer' };
      yield { type: 'result', subtype: 'success' };
    }
  })() as AsyncGenerator<unknown> & {
    setModel: (model?: string) => Promise<void>;
    setPermissionMode: (mode: string) => Promise<void>;
  };

  instance.setModel = async () => {};
  instance.setPermissionMode = async () => {};
  return instance;
}

test('a held session serves two turns on the same process', async () => {
  const session = new HeldClaudeSession({ sessionKey: 'session-1', fingerprint: fingerprint() });
  const seen: unknown[] = [];
  session.start(fakeQuery(session, seen), () => {});

  const first: unknown[] = [];
  await session.runTurn({ promptMessages: [{ text: 'one' }], onMessage: (m) => first.push(m) });

  const second: unknown[] = [];
  await session.runTurn({ promptMessages: [{ text: 'two' }], onMessage: (m) => second.push(m) });

  // Both turns went into the one stream the process is reading.
  assert.deepEqual(seen, [{ text: 'one' }, { text: 'two' }]);
  // And each turn saw its own messages, ending at its own result.
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.deepEqual(second[1], { type: 'result', subtype: 'success' });

  session.close();
});

test('a turn is only handed to a process started with what it needs', () => {
  const session = new HeldClaudeSession({ sessionKey: 'session-2', fingerprint: fingerprint() });
  session.start(fakeQuery(session, []), () => {});

  assert.equal(session.matches(fingerprint()), true, 'same startup conditions');
  assert.equal(session.matches(fingerprint({ cwd: '/elsewhere' })), false, 'other project');
  assert.equal(session.matches(fingerprint({ mcp: '' })), false, 'other mcp servers');
  assert.equal(session.matches(fingerprint({ effort: 'xhigh' })), false, 'other effort');
  assert.equal(session.matches(fingerprint({ writer: { name: 'other' } })), false, 'other writer');

  // Model and permission mode are set on the live process, so they do not
  // force a new one.
  assert.equal(session.matches(fingerprint({ model: 'sonnet' })), true, 'model changes live');
  assert.equal(session.matches(fingerprint({ permissionMode: 'plan' })), true, 'mode changes live');

  session.close();
});

test('a closed session takes no further turns', async () => {
  const session = new HeldClaudeSession({ sessionKey: 'session-3', fingerprint: fingerprint() });
  session.start(fakeQuery(session, []), () => {});
  session.close();

  assert.equal(session.matches(fingerprint()), false);
  await assert.rejects(
    () => session.runTurn({ promptMessages: [{ text: 'one' }], onMessage: () => {} }),
    /no longer held/,
  );
});

test('the model is only pushed to the process when it actually changed', async () => {
  const session = new HeldClaudeSession({ sessionKey: 'session-4', fingerprint: fingerprint() });
  const instance = fakeQuery(session, []);
  const models: (string | undefined)[] = [];
  instance.setModel = async (model) => { models.push(model); };
  session.start(instance, () => {});

  await session.applyTurn({ model: 'opus', permissionMode: 'default' });
  assert.deepEqual(models, [], 'unchanged model stays unsent');

  await session.applyTurn({ model: 'sonnet', permissionMode: 'default' });
  assert.deepEqual(models, ['sonnet']);

  session.close();
});
