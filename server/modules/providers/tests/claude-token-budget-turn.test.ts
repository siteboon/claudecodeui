import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * Which readings a whole turn publishes, driven through the run loop with a
 * scripted SDK stream: the per-call guard decides what a frame is worth, and
 * the loop decides whether the turn's summed bill may stand in for it.
 */

const NATIVE_ID = 'native-budget-turn';

async function publishedInputTokens(messages: Record<string, unknown>[]): Promise<number[]> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-budget-turn-'));
  const sent: NormalizedMessage[] = [];
  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
    })();
    const stream = (async function* () {
      for (const message of messages) {
        yield message;
      }
    })();
    return Object.assign(stream, { interrupt: async () => {}, stopTask: async () => {} });
  };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  try {
    await queryClaudeSDK('hello', { sessionId: 'app-budget-turn', cwd }, writer as never, context);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  return sent
    .filter((message) => (message as { text?: string }).text === 'token_budget')
    .map((message) => (message as unknown as { tokenBudget: { inputTokens: number } }).tokenBudget.inputTokens);
}

const init = { type: 'system', subtype: 'init', session_id: NATIVE_ID };
const assistant = (usage?: Record<string, unknown>) => ({
  type: 'assistant',
  session_id: NATIVE_ID,
  parent_tool_use_id: null,
  message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'ok' }], ...(usage ? { usage } : {}) },
});
// The turn's bill: every request summed, far above what the context holds.
const result = {
  type: 'result',
  subtype: 'success',
  session_id: NATIVE_ID,
  result: 'done',
  duration_ms: 1,
  num_turns: 1,
  usage: { input_tokens: 9, cache_creation_input_tokens: 5_000, cache_read_input_tokens: 400_000, output_tokens: 900 },
};

test('a turn whose assistant usage is all partial publishes nothing, not the summed bill', async () => {
  const published = await publishedInputTokens([
    init,
    assistant({ input_tokens: 2, output_tokens: 3 }),
    assistant({ input_tokens: 1, output_tokens: 4 }),
    result,
  ]);
  assert.deepEqual(published, []);
});

test('a complete reading stands through the partial frames that follow it', async () => {
  const published = await publishedInputTokens([
    init,
    assistant({ input_tokens: 12, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 40_000, output_tokens: 5 }),
    assistant({ input_tokens: 1, output_tokens: 4 }),
    result,
  ]);
  assert.deepEqual(published, [42_012]);
});

test('an SDK build with no per-assistant usage still falls back to the bill', async () => {
  const published = await publishedInputTokens([init, assistant(), result]);
  assert.deepEqual(published, [405_009]);
});

test('a later turn in a held run still falls back to its own bill', async () => {
  // A run held open for background work goes on to further turns. The first
  // turn's assistant usage must not stop the second, which carries none, from
  // using its result.
  const secondBill = { ...result, usage: { input_tokens: 4, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 50_000, output_tokens: 70 } };
  const published = await publishedInputTokens([
    init,
    assistant({ input_tokens: 12, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 40_000, output_tokens: 5 }),
    result,
    assistant(),
    secondBill,
  ]);
  assert.deepEqual(published, [42_012, 51_004]);
});

