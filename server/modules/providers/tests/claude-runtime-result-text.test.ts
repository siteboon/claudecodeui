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
 * A result-only native command (`/context`, `/usage`, …) answers through the
 * turn's `result.result` string alone — the CLI sends no assistant message
 * for it. Without synthesizing one, the client sees the command line and
 * then nothing. These drive `queryClaudeSDK` with a scripted SDK stream —
 * the seam is `context.createQuery` — and inspect what gets sent to the
 * client, same harness pattern as claude-runtime-hold.test.ts.
 */

const SESSION_ID = 'app-result-text-session';
const NATIVE_ID = 'native-result-text-session';

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
};

function createScriptedQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
    })();

    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
      }
    })();

    return Object.assign(iterator, {
      interrupt: async () => {},
      stopTask: async () => {},
    });
  };

  return { createQuery, script };
}

async function withRun(
  runTest: (context: { script: Scripted; sent: NormalizedMessage[]; done: Promise<unknown> }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-result-text-'));
  const { createQuery, script } = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    const done = queryClaudeSDK('/context', { sessionId: SESSION_ID, cwd }, writer as never, context);
    await runTest({ script, sent, done });
    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

const init = () => ({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
const assistantText = (text: string) => ({
  type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const result = (text: string) => ({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: text, duration_ms: 1, num_turns: 1 });

test('a result-only turn synthesizes one assistant text message before complete', async () => {
  await withRun(async ({ script, sent }) => {
    script.emit(init());
    script.emit(result('## Context Usage\n\n**Tokens:** 14.1k / 1m (1%)'));
    await settle();

    const textMessages = sent.filter((message) => message.kind === 'text' && message.role === 'assistant');
    assert.equal(textMessages.length, 1, 'exactly one synthesized assistant text message');
    assert.equal(textMessages[0]?.content, '## Context Usage\n\n**Tokens:** 14.1k / 1m (1%)');

    const textIndex = sent.indexOf(textMessages[0]!);
    const completeIndex = sent.findIndex((message) => message.kind === 'complete');
    assert.ok(completeIndex !== -1, 'a complete message was sent');
    assert.ok(textIndex < completeIndex, 'the synthesized text is sent before complete');
  });
});

test('a turn that already streamed assistant text does not get a duplicate from the result', async () => {
  await withRun(async ({ script, sent }) => {
    script.emit(init());
    script.emit(assistantText('## Context Usage\n\n**Tokens:** 14.1k / 1m (1%)'));
    script.emit(result('## Context Usage\n\n**Tokens:** 14.1k / 1m (1%)'));
    await settle();

    const textMessages = sent.filter((message) => message.kind === 'text' && message.role === 'assistant');
    assert.equal(textMessages.length, 1, 'the streamed message is not duplicated by the result');
  });
});
