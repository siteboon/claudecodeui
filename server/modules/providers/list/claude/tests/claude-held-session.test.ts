import assert from 'node:assert/strict';
import test from 'node:test';

import { HeldClaudeSession } from '@/modules/providers/list/claude/claude-held-session.js';

type Fingerprint = {
  cwd: string;
  mcp: string;
  tools: string;
  effort: string;
  model: string;
  permissionMode: string;
  writer: unknown;
};

const writer = { name: 'writer' };

const fingerprint = (overrides: Partial<Fingerprint> = {}): Fingerprint => ({
  cwd: '/workspace',
  mcp: '{"chrome-tabs":{"command":"claude"}}',
  tools: '{"allowed":[],"disallowed":[]}',
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
  assert.equal(
    session.matches(fingerprint({ tools: '{"allowed":["Bash"],"disallowed":[]}' })),
    false,
    'other tool policy',
  );
  assert.equal(session.matches(fingerprint({ effort: 'xhigh' })), false, 'other effort');
  // Deliberately divergent from the PR this module came from, which refused a
  // turn arriving on a different writer. The run registry builds a new writer
  // per run, so that rule matched nothing and no process was ever reused. The
  // writer is adopted per turn instead — which is also what lets one process
  // serve a conversation carried from a laptop to a phone and back.
  assert.equal(
    session.matches(fingerprint({ writer: { name: 'other' } })),
    true,
    'a different writer is adopted, not refused',
  );

  // Model and permission mode are set on the live process, so they do not
  // force a new one.
  assert.equal(session.matches(fingerprint({ model: 'sonnet' })), true, 'model changes live');
  assert.equal(session.matches(fingerprint({ permissionMode: 'plan' })), true, 'mode changes live');

  session.close();
});

test('a second turn cannot touch a process that is already serving one', async () => {
  // The damage this prevents: `applyTurn` writes the model, the permission
  // mode and the tool list into what the running turn reads from. A turn that
  // did all that and only then found the session busy would leave its settings
  // behind - the first turn would finish under the second one's.
  const sdkOptions = { permissionMode: 'default', allowedTools: [] as string[] };
  const session = new HeldClaudeSession({ sessionKey: 'session-7', fingerprint: fingerprint() });

  // A query that answers nothing, so the first turn stays open. It yields
  // nothing on purpose - that is the whole fixture - so require-yield has to
  // step aside here rather than be satisfied with unreachable code.
  // eslint-disable-next-line require-yield
  const idle = (async function* () {
    for await (const _message of session.promptStream()) {
      // The turn never gets its `result`.
    }
  })() as AsyncGenerator<unknown> & {
    setModel: (model?: string) => Promise<void>;
    setPermissionMode: (mode: string) => Promise<void>;
  };
  idle.setModel = async () => {};
  idle.setPermissionMode = async () => {};
  session.start(idle, () => {}, sdkOptions);

  assert.equal(session.reserve(), true, 'the first turn claims it');
  const running = session.runTurn({
    promptMessages: [{ text: 'one' }],
    onMessage: () => {},
    reserved: true,
  });
  running.catch(() => {});

  assert.equal(session.reserve(), false, 'the second one is refused');
  await assert.rejects(
    () => session.runTurn({ promptMessages: [{ text: 'two' }], onMessage: () => {} }),
    /already serving a turn/,
  );
  assert.deepEqual(sdkOptions, { permissionMode: 'default', allowedTools: [] }, 'and changed nothing');

  session.close();
});

test('a claim that never becomes a turn is given back', () => {
  const session = new HeldClaudeSession({ sessionKey: 'session-8', fingerprint: fingerprint() });
  session.start(fakeQuery(session, []), () => {});

  assert.equal(session.reserve(), true);
  assert.equal(session.reserve(), false);
  session.cancelReservation();
  assert.equal(session.reserve(), true, 'the process is free again, not blocked for good');

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

test('turning off "skip permissions" reaches the tool callback as well', async () => {
  // `canUseTool` reads the mode off the options object it was built with. If a
  // held process kept the first turn's object, switching the mode back would
  // leave that callback approving everything.
  const sdkOptions: { permissionMode: string } = { permissionMode: 'bypassPermissions' };
  const session = new HeldClaudeSession({
    sessionKey: 'session-5',
    fingerprint: fingerprint({ permissionMode: 'bypassPermissions' }),
  });
  session.start(fakeQuery(session, []), () => {}, sdkOptions);

  await session.applyTurn({ model: 'opus', permissionMode: 'default' });

  assert.equal(sdkOptions.permissionMode, 'default');
  session.close();
});

test('stepping into a plan and back keeps the process, its tools, and what was remembered', async () => {
  // Plan mode adds read-only tools of its own. They are deliberately not part
  // of the fingerprint - otherwise every step into a plan would cost a new
  // process - so they have to reach the options `canUseTool` reads, or it
  // would ask about every Read the plan makes.
  const sdkOptions: { permissionMode: string; allowedTools: string[] } = {
    permissionMode: 'default',
    allowedTools: ['Bash(git:*)'],
  };
  const session = new HeldClaudeSession({ sessionKey: 'session-6', fingerprint: fingerprint() });
  session.start(fakeQuery(session, []), () => {}, sdkOptions);

  // Mid-conversation the user allows one more tool and asks to remember it;
  // `canUseTool` writes it straight into the options.
  sdkOptions.allowedTools.push('Write');

  await session.applyTurn({
    model: 'opus',
    permissionMode: 'plan',
    allowedTools: ['Bash(git:*)', 'Read', 'exit_plan_mode'],
  });

  assert.equal(sdkOptions.permissionMode, 'plan');
  assert.deepEqual(
    sdkOptions.allowedTools,
    ['Bash(git:*)', 'Read', 'exit_plan_mode', 'Write'],
    'the plan tools arrive, the remembered one stays',
  );

  await session.applyTurn({
    model: 'opus',
    permissionMode: 'default',
    allowedTools: ['Bash(git:*)'],
  });

  assert.deepEqual(
    sdkOptions.allowedTools,
    ['Bash(git:*)', 'Write'],
    'leaving the plan takes its tools away again',
  );

  session.close();
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

test('the adopted writer is the one a later turn answers on', () => {
  const laptop = { name: 'laptop' };
  const phone = { name: 'phone' };
  const session = new HeldClaudeSession({ sessionKey: 'session-adopt', fingerprint: fingerprint() });

  session.adopt(laptop);
  assert.equal(session.writer, laptop);

  // The conversation moves to another device mid-run; the held process stays.
  session.adopt(phone);
  assert.equal(session.writer, phone, 'a permission prompt must reach whoever asked for this turn');
});

test('outstanding work suspends the idle countdown, and finishing restarts it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = new HeldClaudeSession({
    sessionKey: 'session-outstanding',
    fingerprint: fingerprint(),
    idleMs: 1000,
  });
  session.start(fakeQuery(session, []), () => {});

  session.setOutstandingWork(true);
  t.mock.timers.tick(5000);
  assert.equal(session.closed, false, 'a quiet background job must not be cut off');

  session.setOutstandingWork(false);
  t.mock.timers.tick(1001);
  assert.equal(session.closed, true, 'once nothing is left to wait for, quiet means idle');
});

test('recurring work suspends the countdown for good', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = new HeldClaudeSession({
    sessionKey: 'session-recurring',
    fingerprint: fingerprint(),
    idleMs: 1000,
  });
  session.start(fakeQuery(session, []), () => {});

  session.setRecurring();
  // A cron that ticks every ten minutes leaves far longer gaps than this.
  t.mock.timers.tick(60_000);
  assert.equal(session.closed, false, 'silence between ticks is not an ending');

  // Even a turn reporting no outstanding work must not undo it: the cron is
  // still armed, and nothing in a later turn says so.
  session.setOutstandingWork(false);
  t.mock.timers.tick(60_000);
  assert.equal(session.closed, false, 'the flag is sticky for the life of the process');
});

/**
 * A process driven frame by frame, so a test can make one arrive while no turn
 * is running - a background job reporting in minutes after the turn that
 * launched it, which is what a held session exists for.
 */
function fakeDrivenQuery() {
  const queued: unknown[] = [];
  let wake: (() => void) | null = null;
  let done = false;

  const instance = (async function* () {
    while (!done) {
      while (queued.length > 0) {
        yield queued.shift();
      }
      if (done) {
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  })() as AsyncGenerator<unknown> & {
    setModel: (model?: string) => Promise<void>;
    setPermissionMode: (mode: string) => Promise<void>;
  };

  instance.setModel = async () => {};
  instance.setPermissionMode = async () => {};

  return {
    instance,
    /** Pushes frames into the stream and lets the pump read them. */
    emit(...messages: unknown[]) {
      queued.push(...messages);
      wake?.();
      // Two turns of the microtask queue: one to wake the generator, one for
      // the pump to hand what it read to its listener.
      return new Promise<void>((resolve) => setImmediate(resolve));
    },
    stop() {
      done = true;
      wake?.();
    },
  };
}

test('work that reports in between turns reaches the handler the last turn left', async () => {
  const session = new HeldClaudeSession({ sessionKey: 'session-background', fingerprint: fingerprint() });
  const query = fakeDrivenQuery();
  session.start(query.instance, () => {});

  const turn: unknown[] = [];
  const running = session.runTurn({ promptMessages: [{ text: 'run the workflow' }], onMessage: (m) => turn.push(m) });
  await query.emit({ type: 'assistant', text: 'launched' }, { type: 'result', subtype: 'success' });
  await running;

  const afterwards: unknown[] = [];
  session.setBetweenTurnsHandler((message) => afterwards.push(message));

  // The frame that used to be dropped: the turn is over, the work is not.
  const progress = { type: 'system', subtype: 'task_progress', task_id: 'w1' };
  await query.emit(progress);
  assert.deepEqual(afterwards, [progress]);

  // A turn that starts again takes priority over the standing handler.
  const second: unknown[] = [];
  const secondTurn = session.runTurn({ promptMessages: [{ text: 'and again' }], onMessage: (m) => second.push(m) });
  await query.emit({ type: 'assistant', text: 'answer' }, { type: 'result', subtype: 'success' });
  await secondTurn;

  assert.equal(second.length, 2);
  assert.equal(afterwards.length, 1, 'a running turn is served by the turn, not by the handler');

  query.stop();
  session.close();
  assert.equal(session.betweenTurns, null, 'a closed session has nobody left to deliver to');
});

test('a between-turns delivery that throws does not end the stream', async () => {
  const session = new HeldClaudeSession({ sessionKey: 'session-background-throws', fingerprint: fingerprint() });
  const query = fakeDrivenQuery();
  session.start(query.instance, () => {});

  const first = session.runTurn({ promptMessages: [{ text: 'one' }], onMessage: () => {} });
  await query.emit({ type: 'result', subtype: 'success' });
  await first;

  session.setBetweenTurnsHandler(() => {
    throw new Error('socket is gone');
  });
  await query.emit({ type: 'system', subtype: 'task_progress' });

  // The socket it was addressed to may be long gone; the process must not be.
  const second: unknown[] = [];
  const secondTurn = session.runTurn({ promptMessages: [{ text: 'two' }], onMessage: (m) => second.push(m) });
  await query.emit({ type: 'assistant', text: 'answer' }, { type: 'result', subtype: 'success' });
  await secondTurn;

  assert.equal(second.length, 2, 'the process still serves turns');

  query.stop();
  session.close();
});
