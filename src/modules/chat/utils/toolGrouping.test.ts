import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { ChatMessage } from '@/shared/types';

import {
  groupConsecutiveTools,
  getNormalizedToolGroupKey,
  isToolGroupItem,
} from '@/modules/chat/utils/toolGrouping';

function createMockToolMessage(toolName: string, id: string): ChatMessage {
  return {
    id,
    type: 'tool',
    isToolUse: true,
    toolName,
    content: '',
    timestamp: '2026-09-03T00:00:00.000Z',
    sender: 'assistant',
  };
}

test('getNormalizedToolGroupKey normalizes Antigravity tool names to standard names', () => {
  assert.equal(getNormalizedToolGroupKey('run_command'), 'Bash');
  assert.equal(getNormalizedToolGroupKey('view_file'), 'Read');
  assert.equal(getNormalizedToolGroupKey('replace_file_content'), 'Edit');
  assert.equal(getNormalizedToolGroupKey('write_to_file'), 'Write');
  assert.equal(getNormalizedToolGroupKey('find_by_name'), 'Glob');
  assert.equal(getNormalizedToolGroupKey('grep_search'), 'Grep');
  assert.equal(getNormalizedToolGroupKey('list_dir'), 'LS');
  assert.equal(getNormalizedToolGroupKey('search_web'), 'WebSearch');
  assert.equal(getNormalizedToolGroupKey('read_url_content'), 'WebFetch');
  assert.equal(getNormalizedToolGroupKey('manage_task'), 'Task');
  assert.equal(getNormalizedToolGroupKey('invoke_subagent'), 'Subagent');
  assert.equal(getNormalizedToolGroupKey('manage_subagents'), 'Subagent');
  assert.equal(getNormalizedToolGroupKey('Bash'), 'Bash');
  assert.equal(getNormalizedToolGroupKey('Read'), 'Read');
  assert.equal(getNormalizedToolGroupKey('exec'), 'Bash');
  assert.equal(getNormalizedToolGroupKey('command_execution'), 'Bash');
  assert.equal(getNormalizedToolGroupKey('ApplyPatch'), 'Edit');
  assert.equal(getNormalizedToolGroupKey('update_plan'), 'Plan');
});

test('groupConsecutiveTools groups Codex exec and command_execution tools into a Bash group', () => {
  const messages: ChatMessage[] = [
    createMockToolMessage('exec', '1'),
    createMockToolMessage('command_execution', '2'),
    createMockToolMessage('Bash', '3'),
  ];

  const result = groupConsecutiveTools(messages);
  assert.equal(result.length, 1);
  assert.ok(isToolGroupItem(result[0]));
  assert.equal(result[0].toolName, 'Bash');
  assert.equal(result[0].messages.length, 3);
});

test('groupConsecutiveTools groups tools across empty or hidden thinking messages', () => {
  const emptyThinking: ChatMessage = {
    id: 'think-1',
    type: 'assistant',
    isThinking: true,
    content: '',
    timestamp: '2026-09-03T00:00:00.000Z',
    sender: 'assistant',
  };
  const messages: ChatMessage[] = [
    createMockToolMessage('Bash', '1'),
    emptyThinking,
    createMockToolMessage('Bash', '2'),
  ];

  const result = groupConsecutiveTools(messages, true);
  assert.equal(result.length, 1);
  assert.ok(isToolGroupItem(result[0]));
  assert.equal(result[0].messages.length, 2);
});

test('groupConsecutiveTools groups consecutive run_command tools into a Bash group', () => {
  const messages: ChatMessage[] = [
    createMockToolMessage('run_command', '1'),
    createMockToolMessage('run_command', '2'),
    createMockToolMessage('run_command', '3'),
  ];

  const result = groupConsecutiveTools(messages);
  assert.equal(result.length, 1);
  assert.ok(isToolGroupItem(result[0]));
  assert.equal(result[0].toolName, 'Bash');
  assert.equal(result[0].messages.length, 3);
});

test('groupConsecutiveTools groups mixed Bash and run_command if consecutive', () => {
  const messages: ChatMessage[] = [
    createMockToolMessage('Bash', '1'),
    createMockToolMessage('run_command', '2'),
  ];

  const result = groupConsecutiveTools(messages);
  assert.equal(result.length, 1);
  assert.ok(isToolGroupItem(result[0]));
  assert.equal(result[0].toolName, 'Bash');
  assert.equal(result[0].messages.length, 2);
});

test('groupConsecutiveTools does not group single run_command message', () => {
  const messages: ChatMessage[] = [
    createMockToolMessage('run_command', '1'),
  ];

  const result = groupConsecutiveTools(messages);
  assert.equal(result.length, 1);
  assert.equal(isToolGroupItem(result[0]), false);
});
