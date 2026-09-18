import assert from 'node:assert/strict';
import test from 'node:test';

import { isSubagentPromptEcho } from '@/modules/providers/list/claude/claude-runtime.provider.js';

test('a subagent prompt echo is suppressed', () => {
  // The Agent tool card already shows this prompt, and the transcript keeps the
  // turn in the subagent sidechain, so streaming it stacked a duplicate user
  // bubble that vanished on reload.
  assert.equal(
    isSubagentPromptEcho({ kind: 'text', role: 'user', parentToolUseId: 'toolu_1', content: 'Investigate' }),
    true,
  );
});

test('the session prompt is kept', () => {
  assert.equal(isSubagentPromptEcho({ kind: 'text', role: 'user', content: 'Hello' }), false);
});

test('subagent tool traffic is kept', () => {
  assert.equal(
    isSubagentPromptEcho({ kind: 'tool_result', toolId: 'toolu_2', parentToolUseId: 'toolu_1' }),
    false,
  );
});
