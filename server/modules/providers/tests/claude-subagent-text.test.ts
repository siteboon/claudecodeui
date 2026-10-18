import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/types.js';

/**
 * By default the CLI forwards only a subagent's tool_use/tool_result blocks,
 * so a running agent's card showed its tools but none of its prose until a
 * reload read the transcript from disk. The run asks for the full subagent
 * conversation instead.
 */

test('a run asks the CLI to forward subagent text and thinking', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-subagent-text-'));
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  let options: Record<string, unknown> | undefined;
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery: (args) => {
      options = args.options as Record<string, unknown>;
      void (async () => { for await (const _message of args.prompt) { /* read */ } })();
      const iterator = (async function* () {
        yield { type: 'result', subtype: 'success', session_id: 'native-subagent-text', result: 'ok', duration_ms: 1, num_turns: 1 };
      })();
      return Object.assign(iterator, { interrupt: async () => {} }) as never;
    },
  };

  try {
    await queryClaudeSDK('hello', { sessionId: 'app-subagent-text', cwd }, { send: () => {}, userId: null } as never, context);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }

  assert.equal(options?.forwardSubagentText, true);
});
