import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK, resultOutcome } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * A turn's terminal `complete` follows the SDK `result`: an error result
 * (`is_error`, or an `error_*` subtype) ends the turn with exit code 1 instead
 * of being reported as a success.
 */

const NATIVE_ID = 'native-outcome-session';

/** Runs one turn against a scripted SDK stream and returns what the client received. */
async function runTurn(resultMessage: Record<string, unknown>): Promise<NormalizedMessage[]> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-result-outcome-'));
  const sent: NormalizedMessage[] = [];
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
    createQuery: ({ prompt }) => {
      // Drain stdin like the CLI would, so the release at the end of the turn completes.
      void (async () => { for await (const _message of prompt) { /* read */ } })();
      const stream = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: NATIVE_ID };
        yield { session_id: NATIVE_ID, duration_ms: 1, num_turns: 1, ...resultMessage, type: 'result' };
      })();
      return Object.assign(stream, { interrupt: async () => {} });
    },
  };

  try {
    await queryClaudeSDK('hello', { sessionId: `app-outcome-${Math.random()}`, cwd }, { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null } as never, context);
    return sent;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const completes = (sent: NormalizedMessage[]) => sent.filter((message) => message.kind === 'complete');

test('a successful result completes the turn with exit code 0', async () => {
  const sent = await runTurn({ subtype: 'success', is_error: false, result: 'done' });
  assert.deepEqual(completes(sent).map((message) => message.exitCode), [0]);
  assert.equal(sent.some((message) => message.kind === 'error'), false);
});

test('an error_* subtype fails the turn and says why', async () => {
  const sent = await runTurn({ subtype: 'error_max_turns', is_error: true, errors: ['Reached maximum number of turns (3)'] });
  assert.deepEqual(completes(sent).map((message) => message.exitCode), [1]);
  const error = sent.find((message) => message.kind === 'error');
  assert.ok(error);
  assert.match(String(error.content), /error_max_turns: Reached maximum number of turns/);
});

test('is_error on a success subtype fails the turn without repeating the streamed error text', async () => {
  const sent = await runTurn({ subtype: 'success', is_error: true, result: 'API Error: 529 overloaded' });
  assert.deepEqual(completes(sent).map((message) => message.exitCode), [1]);
  assert.equal(sent.some((message) => message.kind === 'error'), false);
});

test('resultOutcome classifies results and builds a readable reason', () => {
  assert.deepEqual(resultOutcome({ subtype: 'success', is_error: false }), { failed: false, reason: 'completed' });
  assert.deepEqual(resultOutcome({}), { failed: false, reason: 'completed' });
  assert.deepEqual(resultOutcome({ subtype: 'error_during_execution' }), { failed: true, reason: 'error_during_execution' });
  assert.deepEqual(
    resultOutcome({ subtype: 'error_max_budget_usd', errors: ['Budget exceeded', '', 7] }),
    { failed: true, reason: 'error_max_budget_usd: Budget exceeded' },
  );
  assert.deepEqual(
    resultOutcome({ subtype: 'success', is_error: true, result: 'API Error: 500' }),
    { failed: true, reason: 'error: API Error: 500' },
  );
});
