import assert from 'node:assert/strict';

import { test } from 'vitest';

import { CANONICAL_SUBAGENT_TOOL, SUBAGENT_TOOL_NAMES, isSubagentToolName } from '@/modules/chat/tools/toolAliases';

test('both names the subagent tool has had are recognised', () => {
  assert.equal(isSubagentToolName('Agent'), true);
  assert.equal(isSubagentToolName('Task'), true);
});

test('tools that merely start with Task are not subagents', () => {
  for (const name of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']) {
    assert.equal(isSubagentToolName(name), false, `${name} is a task-tracking tool, not a subagent`);
  }
});

test('nothing else is a subagent, including empty input', () => {
  for (const name of ['Bash', 'Read', 'Workflow', 'agent', 'AGENT', '', undefined, null]) {
    assert.equal(isSubagentToolName(name), false, `${String(name)} should not match`);
  }
});

test('the canonical name is the current one, not the legacy one', () => {
  assert.equal(CANONICAL_SUBAGENT_TOOL, 'Agent');
  assert.equal(SUBAGENT_TOOL_NAMES[0], 'Agent');
  assert.ok(SUBAGENT_TOOL_NAMES.includes('Task'), 'the old name must stay: old transcripts are read forever');
});
