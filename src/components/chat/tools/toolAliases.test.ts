import assert from 'node:assert/strict';
import test from 'node:test';

import { getToolConfig } from './configs/toolConfigs';
import { canonicalToolName, isSubagentTool } from './toolAliases';

/**
 * Regression guard: spawning a subagent rendered the entire prompt inline as a
 * wall of text that looked like a message the user had typed. Cause was a
 * silent rename — Claude Code's subagent tool went from `Task` to `Agent`, no
 * config matched, and it fell through to `Default`, which titles the block
 * "Parameters" and dumps the raw input as JSON.
 *
 * The failure mode is what makes these tests worth having: a missing config is
 * not an error, it degrades. Nothing throws, nothing logs, the UI just gets
 * worse. So the assertions below check the tool resolves to the RICH config,
 * not merely that it resolves to something.
 */

test('the subagent tool resolves to the same config under both its names', () => {
  const viaOldName = getToolConfig('Task');
  const viaNewName = getToolConfig('Agent');
  assert.equal(viaNewName, viaOldName, 'Agent must share Task config, not fall through to Default');
});

test('the subagent tool does NOT fall through to the Default parameter dump', () => {
  const agent = getToolConfig('Agent');
  const fallback = getToolConfig('a-tool-that-does-not-exist');
  assert.notEqual(agent, fallback, 'Agent is resolving to Default — the rename regressed');
  // Default titles the block a literal 'Parameters'; the subagent config
  // builds a "Subagent / <type>: <description>" title from the input instead.
  assert.equal(typeof agent.input?.title, 'function', 'expected a computed subagent title');
});

test('the computed title describes the subagent rather than dumping input', () => {
  const agent = getToolConfig('Agent');
  const title = typeof agent.input?.title === 'function'
    ? agent.input.title({ subagent_type: 'code-reviewer', description: 'Review the diff' })
    : String(agent.input?.title);
  assert.match(title, /code-reviewer/);
  assert.match(title, /Review the diff/);
});

test('the subagent config shows the prompt alone when nothing else is set', () => {
  const agent = getToolConfig('Agent');
  const props = agent.input?.getContentProps?.({ prompt: 'do the thing' });
  // The prompt is rendered on its own, not as a JSON blob of every field.
  assert.equal(props?.content, 'do the thing');
});

test('both names are recognised as the subagent tool', () => {
  assert.equal(isSubagentTool('Agent'), true);
  assert.equal(isSubagentTool('Task'), true, 'older transcripts still say Task');
  assert.equal(isSubagentTool('Bash'), false);
  assert.equal(isSubagentTool(null), false);
  assert.equal(isSubagentTool(undefined), false);
});

test('unknown tool names pass through untouched', () => {
  assert.equal(canonicalToolName('Bash'), 'Bash');
  assert.equal(canonicalToolName('mcp__whatever__thing'), 'mcp__whatever__thing');
  assert.equal(canonicalToolName(''), '');
});
