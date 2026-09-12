import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { NormalizedMessage, SubagentSummary } from '@/shared/types';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import {
  buildSubagentContinuationPrompt,
  extractLiveSubagentMessages,
  mergeSubagentMessages,
} from '@/modules/chat/utils/sessionSubagents';

/**
 * The info panel's agent view reads one agent's rows out of the PARENT
 * session's live slot. Two rules keep that honest: rows are selected by
 * their spawn stamp (`parentToolUseId`), and the stamp is stripped before
 * conversion — `normalizedToChatMessages` folds stamped rows into the
 * parent's Task container, which is exactly what this view must not do.
 */

function message(id: string, overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id,
    sessionId: 'parent-1',
    timestamp: '2026-09-11T12:00:00.000Z',
    provider: 'claude',
    kind: 'text',
    role: 'assistant',
    content: id,
    ...overrides,
  };
}

const agentRow = (id: string, overrides: Partial<NormalizedMessage> = {}): NormalizedMessage =>
  message(id, { parentToolUseId: 'toolu_launch', ...overrides });

test('only the matching stamp survives, and the stamp is stripped', () => {
  const rows = [
    message('parent-text'),
    agentRow('agent-text'),
    agentRow('agent-tool', { kind: 'tool_use', toolId: 'b1', toolName: 'Bash', toolInput: { command: 'ls' } }),
    message('other-agent', { parentToolUseId: 'toolu_other' }),
  ];

  const live = extractLiveSubagentMessages(rows, 'toolu_launch');
  assert.deepEqual(live.map((row) => row.id), ['agent-text', 'agent-tool']);
  assert.ok(live.every((row) => row.parentToolUseId === undefined), 'the stamp must be removed');

  // Stripped rows convert to top-level chat messages, not a folded container.
  const converted = normalizedToChatMessages(live);
  assert.equal(converted.length, 2);
  assert.ok(converted.every((entry) => !entry.isSubagentContainer));
});

test('the echoed prompt and run-control rows never join the agent view', () => {
  const live = extractLiveSubagentMessages([
    agentRow('echo', { role: 'user', content: 'do the task' }),
    agentRow('note'),
    agentRow('done', { kind: 'complete' }),
    agentRow('frame', { kind: 'status' }),
  ], 'toolu_launch');

  assert.deepEqual(live.map((row) => row.id), ['note']);
});

test('an agent without a known tool id has no derivable live rows', () => {
  assert.deepEqual(extractLiveSubagentMessages([agentRow('x')], undefined), []);
});

test('merge dedupes by id and by paired tool rows', () => {
  const history = [
    message('h1'),
    agentRow('h-tool', { kind: 'tool_use', toolId: 'b1', toolName: 'Bash' }),
  ];
  const live = [
    message('h1'), // same id already in the page
    agentRow('live-tool', { kind: 'tool_result', toolId: 'b1', content: 'done' }), // paired row, different id
    agentRow('fresh'),
  ];

  const merged = mergeSubagentMessages(history, live);
  // h1 dedupes by id; live-tool dedupes against h-tool by (kind,toolId)…
  // except it is a tool_RESULT and h-tool is a tool_USE — different keys, so
  // it legitimately joins as the missing result half.
  assert.deepEqual(merged.map((row) => row.id), ['h1', 'h-tool', 'live-tool', 'fresh']);

  const resultDup = mergeSubagentMessages(
    [...history, agentRow('h-result', { kind: 'tool_result', toolId: 'b1', content: 'done' })],
    [agentRow('live-tool', { kind: 'tool_result', toolId: 'b1', content: 'done' })],
  );
  assert.equal(resultDup.length, 3, 'an already-paged tool_result must not reappear');
});

const summary: SubagentSummary = {
  agentId: 'alpha', agentType: 'Explore', description: 'survey the repo',
  toolUseId: 'toolu_launch', status: 'completed', activityCount: 3,
};

test('the continuation prompt carries identity, log, and the user’s words', () => {
  const history = [
    agentRow('think', { kind: 'thinking', content: 'checking entry points' }),
    agentRow('call', { kind: 'tool_use', toolId: 'b1', toolName: 'Bash', toolInput: { command: 'ls src' } }),
    agentRow('res', { kind: 'tool_result', toolId: 'b1', content: 'index.ts\nmain.ts' }),
    agentRow('say', { content: 'the entry point is main.ts' }),
  ];

  const prompt = buildSubagentContinuationPrompt({ summary, history, userText: 'then what about tests?' });

  assert.match(prompt, /「Explore」（survey the repo）/);
  assert.match(prompt, /checking entry points/);
  assert.match(prompt, /调用 Bash/);
  assert.match(prompt, /index\.ts/);
  assert.match(prompt, /main\.ts/);
  assert.ok(prompt.trimEnd().endsWith('then what about tests?'), 'the user’s words come last');
});

test('injected copy replaces the prose seams', () => {
  const prompt = buildSubagentContinuationPrompt({
    summary,
    history: [agentRow('say', { content: 'earlier finding' })],
    userText: 'hello',
    copy: { identity: 'You are "Explore".', logIntro: 'Your earlier record:', askIntro: 'Now answer:' },
  });

  assert.ok(prompt.startsWith('You are "Explore".'));
  assert.match(prompt, /Your earlier record:.*earlier finding/s);
  assert.match(prompt, /Now answer:\nhello/);
});

test('an oversized log keeps its tail', () => {
  const history = Array.from({ length: 400 }, (_, index) =>
    agentRow(`row-${index}`, { content: `line ${index} ${'x'.repeat(200)}` }));

  const prompt = buildSubagentContinuationPrompt({ summary, history, userText: 'next?' });

  assert.ok(prompt.includes('仅保留最近部分'), 'truncation is announced');
  assert.ok(prompt.includes('line 399'), 'the newest rows survive');
  assert.ok(!prompt.includes('line 0 xxx'), 'the oldest rows are dropped');
});
