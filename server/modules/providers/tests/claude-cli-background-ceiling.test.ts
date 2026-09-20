import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * The background-wait ceiling we hand to the CLI child (T27).
 *
 * `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` is a watchdog *inside* the child: it
 * kills still-running background agents once it expires, and it never looks at
 * stdin, so none of the hold logic in the provider can protect that work. We
 * used to set it to the same 30 minutes as the idle hold, which silently ended
 * every workflow that ran longer than half an hour. The only trace was one line
 * on the child's stderr, and every test here was blind to it — nobody writes a
 * thirty-minute test.
 *
 * Two things make it writable. `context.createQuery` (ported from upstream
 * #1291/#1347) lets a scripted stream stand in for the CLI, and the fake below
 * runs the scenario in scaled time: it reasons in the real durations — a 45
 * minute workflow, a 30 minute ceiling — while sleeping one millisecond per
 * modelled minute. So the values under test are the production values, not
 * miniatures of them, and the whole thing takes a few hundred milliseconds.
 */

/** One real millisecond per modelled minute. */
const SPEEDUP = 60 * 1000;
/** A workflow of the length that actually gets killed. `wyvz9wpx3` ran 29m47s. */
const MODELLED_WORK_MS = 45 * 60 * 1000;
/** What we used to send, and what T27's reproduction puts back. */
const OLD_CEILING_MS = 30 * 60 * 1000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A stand-in for the Claude CLI that reproduces the one behaviour under test:
 * it reads the ceiling out of the environment we build for it, and if that
 * ceiling expires before the background work reports back, it terminates the
 * work and ends its stream instead of pushing the follow-up turn.
 *
 * Which of the two deadlines wins is decided by comparing the modelled
 * durations, not by racing two timers, so a loaded machine cannot flip it.
 */
function fakeClaudeCli(sessionId: string) {
  const record = {
    /** Exactly what we put in the child's environment. */
    ceilingMs: null as string | null,
    /** Whether the watchdog fired and took the background work with it. */
    killed: false,
    stderr: [] as string[],
    /** Resolves when the fake child's stream ends, however it ends. */
    ended: Promise.resolve(),
  };
  let markEnded: () => void = () => {};
  record.ended = new Promise<void>((resolve) => { markEnded = resolve; });

  const createQuery = ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, any> }) => {
    record.ceilingMs = options.env?.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? null;
    const ceilingMs = Number(record.ceilingMs);

    // The real child reads stdin for as long as it is held open. Draining it
    // keeps the held prompt stream behaving like it does in production.
    void (async () => {
      try {
        for await (const _message of prompt) { /* the turn's input */ }
      } catch { /* the stream is closed when the hold is released */ }
    })();

    async function* stream() {
      try {
        // Turn one: launch a workflow, then end the turn. The process stays.
        yield { type: 'system', subtype: 'init', session_id: sessionId };
        yield {
          type: 'assistant',
          session_id: sessionId,
          message: { content: [{ type: 'tool_use', name: 'Workflow', input: { script: '...' } }] },
        };
        yield { type: 'result', subtype: 'success', session_id: sessionId };

        // `0` means "wait indefinitely"; any positive value is a deadline the
        // background work has to beat.
        const watchdogWins = ceilingMs > 0 && ceilingMs < MODELLED_WORK_MS;
        await delay((watchdogWins ? ceilingMs : MODELLED_WORK_MS) / SPEEDUP);

        if (watchdogWins) {
          record.killed = true;
          const line = `Background tasks still running after ${ceilingMs / 1000}s; terminating.`;
          record.stderr.push(line);
          options.stderr?.(Buffer.from(`${line}\n`));
          // The work is gone and so is the process: no follow-up turn is ever
          // pushed, which is exactly what makes this look like a session that
          // quietly stopped.
          return;
        }

        // The work finished and reports back on a follow-up turn.
        yield { type: 'result', subtype: 'success', session_id: sessionId, background_work: true };
      } finally {
        markEnded();
      }
    }

    const iterator = stream();
    return {
      [Symbol.asyncIterator]: () => iterator,
      interrupt: async () => { await iterator.return?.(undefined as never); },
      setModel: async () => {},
      setPermissionMode: async () => {},
    };
  };

  return { createQuery, record };
}

/**
 * Runs one turn that launches background work, then waits for the fake child to
 * finish one way or the other. Returns what the child was told and how many
 * turn-ending `result` frames actually reached the provider: one means the
 * background work never reported back.
 */
async function runWorkflowTurn(t: TestContext, ceilingEnv: string | undefined) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const previous = process.env.CLOUDCLI_CLI_BG_WAIT_CEILING_MS;
  if (ceilingEnv === undefined) {
    delete process.env.CLOUDCLI_CLI_BG_WAIT_CEILING_MS;
  } else {
    process.env.CLOUDCLI_CLI_BG_WAIT_CEILING_MS = ceilingEnv;
  }
  t.after(() => {
    if (previous === undefined) {
      delete process.env.CLOUDCLI_CLI_BG_WAIT_CEILING_MS;
    } else {
      process.env.CLOUDCLI_CLI_BG_WAIT_CEILING_MS = previous;
    }
  });

  const sessionId = `ceiling-${ceilingEnv ?? 'default'}-${Date.now()}`;
  const cli = fakeClaudeCli(sessionId);
  const ws = { send: () => {} };

  let resultsSeen = 0;
  const context = {
    createQuery: cli.createQuery,
    resolveProviderSessionId: () => sessionId,
    resolveResumeModel: async () => null,
    getProviderModels: async () => [],
    isProviderInstalled: async () => true,
    normalizeMessage: (message: { type?: string }) => {
      if (message?.type === 'result') {
        resultsSeen += 1;
      }
      return [];
    },
  };

  await queryClaudeSDK(
    'run a workflow',
    { sessionId, toolsSettings: { keepSessionAlive: true } },
    ws,
    context,
  );
  await cli.record.ended;
  // The follow-up result is delivered from the held session's read loop, a
  // microtask after the stream yields it.
  await new Promise((resolve) => setImmediate(resolve));

  return { record: cli.record, resultsSeen };
}

test('the 30 minutes we used to send kills a 45-minute workflow', async (t) => {
  const { record, resultsSeen } = await runWorkflowTurn(t, String(OLD_CEILING_MS));

  assert.equal(record.ceilingMs, String(OLD_CEILING_MS), 'the ceiling must reach the child');
  assert.equal(record.killed, true, 'the watchdog must have fired');
  assert.match(record.stderr[0], /Background tasks still running after 1800s; terminating\./);
  // The defect, reproduced: the turn ended normally and the work died
  // afterwards, with nothing but a stderr line to say so.
  assert.equal(resultsSeen, 1, 'the background work must not have reported back');
});

test('the default lets the same workflow finish: no watchdog, follow-up turn arrives', async (t) => {
  const { record, resultsSeen } = await runWorkflowTurn(t, undefined);

  // `0` is the CLI's documented "wait indefinitely". Anything else here — in
  // particular the 30 minutes this constant used to hold — fails the run below.
  assert.equal(record.ceilingMs, '0', 'the child must be told not to run a watchdog');
  assert.equal(record.killed, false, 'nothing may be terminated');
  assert.equal(resultsSeen, 2, 'the background work must report back on a follow-up turn');
});

test('a ceiling the work beats is forwarded too, so the override is real and not ignored', async (t) => {
  const generous = String(MODELLED_WORK_MS * 2);
  const { record, resultsSeen } = await runWorkflowTurn(t, generous);

  assert.equal(record.ceilingMs, generous);
  assert.equal(record.killed, false);
  assert.equal(resultsSeen, 2);
});

for (const junk of ['', 'soon', '-1']) {
  test(`CLOUDCLI_CLI_BG_WAIT_CEILING_MS=${JSON.stringify(junk)} falls back to waiting indefinitely`, async (t) => {
    const { record } = await runWorkflowTurn(t, junk);

    // Falling back to anything else would reinstate the kill on a typo.
    assert.equal(record.ceilingMs, '0');
    assert.equal(record.killed, false);
  });
}
