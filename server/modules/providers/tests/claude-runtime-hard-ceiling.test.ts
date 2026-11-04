import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * The hard ceiling ends a hold even while the held work keeps reporting:
 * every message resets the silence countdown, so a task that reports often
 * enough would otherwise keep the process forever. Each test file runs in a
 * process of its own, so the ceiling can be set before the runtime loads.
 */
process.env.CLOUDCLI_BG_HARD_CEILING_MS = '200';

const NATIVE_ID = 'native-ceiling-session';

test('a hold ends at the hard ceiling although the held task keeps reporting', async () => {
  const { queryClaudeSDK } = await import('@/modules/providers/list/claude/claude-runtime.provider.js');
  const { ClaudeSessionsProvider } = await import('@/modules/providers/list/claude/claude-sessions.provider.js');
  const { CLAUDE_PREDEFINED_MODELS } = await import('@/modules/providers/list/claude/claude-models.provider.js');

  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  const emit = (message: Record<string, unknown> | null) => { queue.push(message); wake?.(); };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
      released = true;
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
    return Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} }) as never;
  };

  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-ceiling-'));
  const sent: NormalizedMessage[] = [];
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
    const run = queryClaudeSDK('start an agent', { sessionId: 'app-ceiling-session', cwd }, { send: (m: NormalizedMessage) => { sent.push(m); }, userId: null } as never, context);
    await new Promise((resolve) => { setTimeout(resolve, 25); });
    emit({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
    emit({ type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { prompt: 'work', subagent_type: 'general-purpose', run_in_background: true } }] } });
    emit({ type: 'system', subtype: 'task_started', session_id: NATIVE_ID, task_id: 'a1', tool_use_id: 'toolu_agent', description: 'Task a1', task_type: 'local_agent' });
    emit({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'launched', duration_ms: 1, num_turns: 1 });

    // The task keeps reporting progress, well inside the silence countdown.
    for (let tick = 0; tick < 6; tick += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 60); });
      emit({ type: 'system', subtype: 'task_progress', session_id: NATIVE_ID, task_id: 'a1', tool_use_id: 'toolu_agent', description: 'still working' });
    }

    assert.equal(released, true, 'the hold ended at the 200 ms ceiling');
    emit(null);
    await run;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
