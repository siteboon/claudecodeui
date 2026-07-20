import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractAgentIdFromToolResult,
  extractCursorAgentIds,
  parseCursorSubagentTranscriptPath,
} from './cursor-subagent.js';

test('parseCursorSubagentTranscriptPath detects classic layout', () => {
  const info = parseCursorSubagentTranscriptPath(
    '/root/.cursor/projects/demo/agent-transcripts/parent-uuid/subagents/child-uuid.jsonl',
  );
  assert.deepEqual(info, {
    sessionId: 'child-uuid',
    parentProviderSessionId: 'parent-uuid',
  });
});

test('parseCursorSubagentTranscriptPath ignores peer transcripts', () => {
  assert.equal(
    parseCursorSubagentTranscriptPath(
      '/root/.cursor/projects/demo/agent-transcripts/session-uuid/session-uuid.jsonl',
    ),
    null,
  );
});

test('extractCursorAgentIds finds json and text forms', () => {
  const ids = extractCursorAgentIds(
    'Agent ID: 0940f589-93cd-4f0b-93c0-eca349f5c261 and {"agentId":"4fddc5e1-8208-42c6-be14-dd8f4bcbc9f3"}',
  );
  assert.deepEqual(ids.sort(), [
    '0940f589-93cd-4f0b-93c0-eca349f5c261',
    '4fddc5e1-8208-42c6-be14-dd8f4bcbc9f3',
  ].sort());
});

test('extractAgentIdFromToolResult reads nested toolUseResult', () => {
  assert.equal(
    extractAgentIdFromToolResult({
      content: 'done',
      toolUseResult: { agentId: '8903abc9-08d5-4127-a219-b68fb6cef14e' },
    }),
    '8903abc9-08d5-4127-a219-b68fb6cef14e',
  );
});
