import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { Thread } from '@openai/codex-sdk';

import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

type RunControl = { abort: () => void };

/**
 * Drives a fake Codex event stream through the real runtime provider and the
 * real Codex normalizer, returning every frame the writer received. Going
 * through the normalizer is what makes these assertions describe what the chat
 * transcript actually gets rather than the pre-normalization event shape.
 */
async function runCodexTurn(
  t: TestContext,
  events: (control: RunControl) => AsyncGenerator<unknown>,
  runOptions: Record<string, unknown> = {},
): Promise<NormalizedMessage[]> {
  const messages: NormalizedMessage[] = [];
  const sessionId = (runOptions.sessionId as string | undefined) ?? null;
  const control: RunControl = {
    abort: () => {
      assert.ok(sessionId, 'aborting requires a session id');
      assert.equal(codexRuntime.abort(sessionId), true);
    },
  };
  const thread = {
    id: 'native-thread',
    async runStreamed() {
      return { events: events(control) };
    },
  } as unknown as Thread;

  t.mock.method(Codex.prototype, 'startThread', () => thread);
  t.mock.method(Codex.prototype, 'resumeThread', () => thread);

  const sessions = new CodexSessionsProvider();
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => 'test-model',
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
    normalizeMessage: (raw, id) => sessions.normalizeMessage(raw, id),
    isProviderInstalled: async () => true,
  };

  await codexRuntime.run(
    'hey there',
    { cwd: process.cwd(), ...runOptions },
    { isWebSocketWriter: true, send: (message: unknown) => messages.push(message as NormalizedMessage) },
    context,
  );

  return messages;
}

const threadStarted = { type: 'thread.started', thread_id: 'native-thread' };
const turnStarted = { type: 'turn.started' };
const turnCompleted = {
  type: 'turn.completed',
  usage: { input_tokens: 12, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 },
};

function errorRows(messages: NormalizedMessage[]) {
  return messages.filter((message) => message.kind === 'error');
}

function emptyTurnWarnings(messages: NormalizedMessage[]) {
  return errorRows(messages).filter((message) => /without producing a response/i.test(String(message.content)));
}

test('Codex warns when a turn completes without producing any output', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield turnStarted;
    yield turnCompleted;
  });

  const warnings = emptyTurnWarnings(messages);
  assert.equal(warnings.length, 1, `expected one warning, got ${JSON.stringify(messages.map((m) => m.kind))}`);
  assert.match(String(warnings[0].content), /rejected upstream/i);
  assert.equal(warnings[0].provider, 'codex');
  // The warning has to land before the first `complete` frame: that is what
  // ends the turn for the client, so anything after it arrives too late.
  const firstCompleteIndex = messages.findIndex((message) => message.kind === 'complete');
  assert.ok(messages.indexOf(warnings[0]) < firstCompleteIndex, 'warning must precede the turn completion');
});

test('Codex warns when the only agent message of a turn was empty', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield turnStarted;
    yield { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: '   ' } };
    yield turnCompleted;
  });

  assert.equal(emptyTurnWarnings(messages).length, 1);
});

test('Codex stays quiet when the turn produced an assistant message', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield turnStarted;
    yield { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'all done' } };
    yield turnCompleted;
  });

  assert.equal(errorRows(messages).length, 0);
  assert.ok(messages.some((message) => message.kind === 'text' && message.content === 'all done'));
});

test('Codex stays quiet when the turn only ran a command', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield turnStarted;
    yield {
      type: 'item.completed',
      item: { id: 'item-1', type: 'command_execution', command: 'ls', aggregated_output: 'a.txt', exit_code: 0, status: 'completed' },
    };
    yield turnCompleted;
  });

  assert.equal(errorRows(messages).length, 0);
  assert.ok(messages.some((message) => message.kind === 'tool_use' && message.toolName === 'Bash'));
});

test('Codex stays quiet when the output only arrived as in-flight item updates', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield turnStarted;
    // Progress rows are the only thing a long command shows before it ends;
    // the turn is not silent just because no item reached `item.completed`.
    yield {
      type: 'item.updated',
      item: { id: 'item-1', type: 'command_execution', command: 'npm test', aggregated_output: 'running…', status: 'in_progress' },
    };
    yield turnCompleted;
  });

  assert.equal(errorRows(messages).length, 0);
  assert.ok(messages.some((message) => message.kind === 'tool_use' && message.toolName === 'Bash'));
});

// The sequences below were captured from the real vendored binary
// (`codex exec --json`, codex-cli 0.153.4) against a local fake Responses API.
// Codex reports a fatal failure as a top-level `error` event followed by a
// `turn.failed` carrying the same message; it reuses `error` events for
// transient reconnect notices and `error` items for non-fatal warnings.
const modelMetadataWarning = {
  type: 'item.completed',
  item: {
    id: 'item_0',
    type: 'error',
    message: 'Model metadata for `bogus` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.',
  },
};
const reconnectNotice = {
  type: 'error',
  message: 'Reconnecting... 1/2 (stream disconnected before completion: stream closed before response.completed)',
};

test('Codex shows an upstream rejection once and adds no empty-turn warning', async (t) => {
  const rejection = '{"error":{"message":"The model `bogus` does not exist","type":"invalid_request_error","code":"model_not_found"}}';
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield modelMetadataWarning;
    yield turnStarted;
    yield { type: 'error', message: rejection };
    yield { type: 'turn.failed', error: { message: rejection } };
  });

  const errors = errorRows(messages);
  assert.equal(errors.length, 1, `expected only the failure row, got ${JSON.stringify(errors.map((m) => m.content))}`);
  assert.equal(errors[0].content, rejection);
  assert.equal(emptyTurnWarnings(messages).length, 0);
  assert.ok(messages.some((message) => message.kind === 'complete' && message.exitCode === 1));
});

test('Codex still warns about an empty turn that followed a non-fatal warning item', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield modelMetadataWarning;
    yield turnStarted;
    yield turnCompleted;
  });

  // The warning item is not a transcript row, so the empty-turn warning is
  // the only thing that tells the user why nothing came back.
  const errors = errorRows(messages);
  assert.equal(errors.length, 1, `expected only the empty-turn warning, got ${JSON.stringify(errors.map((m) => m.content))}`);
  assert.equal(emptyTurnWarnings(messages).length, 1);
});

test('Codex does not paint a recovered reconnect as an error', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield turnStarted;
    yield reconnectNotice;
    yield { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'hi there' } };
    yield turnCompleted;
  });

  assert.equal(errorRows(messages).length, 0, `unexpected error rows ${JSON.stringify(errorRows(messages).map((m) => m.content))}`);
  assert.ok(messages.some((message) => message.kind === 'text' && message.content === 'hi there'));
});

test('Codex still warns about an empty turn that followed a reconnect notice', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield turnStarted;
    yield reconnectNotice;
    yield turnCompleted;
  });

  assert.equal(errorRows(messages).length, 1);
  assert.equal(emptyTurnWarnings(messages).length, 1);
});

test('Codex does not warn when the user aborted the run', async (t) => {
  const messages = await runCodexTurn(t, async function* (control) {
    yield threadStarted;
    yield turnStarted;
    control.abort();
    yield turnCompleted;
  }, { sessionId: 'app-session' });

  assert.equal(errorRows(messages).length, 0);
  // Aborted runs get their terminal frame from the abort handler, never here.
  assert.equal(messages.filter((message) => message.kind === 'complete' && typeof message.exitCode === 'number').length, 0);
});

test('Codex does not warn for a later empty turn when an earlier one answered', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield turnStarted;
    yield { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'first answer' } };
    yield turnCompleted;
    yield turnStarted;
    yield turnCompleted;
  });

  assert.equal(emptyTurnWarnings(messages).length, 0);
});

test('Codex warns only once when several turns complete empty', async (t) => {
  const messages = await runCodexTurn(t, async function* () {
    yield threadStarted;
    yield turnStarted;
    yield turnCompleted;
    yield turnStarted;
    yield turnCompleted;
  });

  assert.equal(emptyTurnWarnings(messages).length, 1);
});
