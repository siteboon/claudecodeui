import assert from 'node:assert/strict';
import test from 'node:test';

import { llmMessagesUnifier } from '@/modules/ai-runtime/services/messages-unifier.service.js';

/**
 * This test covers helper-3 Claude normalization: user/assistant/thinking/tool-use/tool-result/error.
 */
test('llmMessagesUnifier normalizes claude message categories', () => {
  const sessionId = 'claude-session-1';

  const thinking = llmMessagesUnifier.normalizeUnknown('claude', sessionId, {
    type: 'assistant',
    timestamp: '2026-04-06T10:00:00.000Z',
    message: {
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Assistant response' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.txt' } },
      ],
    },
  });
  assert.equal(thinking[0]?.type, 'thinking_message');
  assert.equal(thinking[0]?.text, 'Thinking');
  assert.equal(thinking[1]?.type, 'assistant_message');
  assert.equal(thinking[2]?.type, 'tool_use_request');

  const user = llmMessagesUnifier.normalizeUnknown('claude', sessionId, {
    type: 'user',
    message: {
      content: [
        { type: 'text', text: 'hello there' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'image-b64',
          },
        },
      ],
    },
  });
  assert.equal(user[0]?.type, 'user_message');
  assert.equal(user[0]?.text, 'hello there');
  assert.deepEqual(user[0]?.images, ['image-b64']);

  const toolResult = llmMessagesUnifier.normalizeUnknown('claude', sessionId, {
    type: 'user',
    toolUseResult: { success: false, reason: 'denied' },
  });
  assert.equal(toolResult[0]?.type, 'tool_call_error');

  const toolResultSuccess = llmMessagesUnifier.normalizeUnknown('claude', sessionId, {
    type: 'user',
    toolUseResult: { type: 'create', filePath: 'hello.py' },
  });
  assert.equal(toolResultSuccess[0]?.type, 'tool_call_success');

  const todo = llmMessagesUnifier.normalizeUnknown('claude', sessionId, {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_todo',
          name: 'TaskUpdate',
          input: { taskId: '1', status: 'in_progress' },
        },
      ],
    },
  });
  assert.equal(todo[0]?.type, 'todo_task_list');
  assert.equal(todo[0]?.has_progress_indicator, true);

  const assistantError = llmMessagesUnifier.normalizeUnknown('claude', sessionId, {
    type: 'assistant',
    error: 'rate_limit',
    message: { content: [] },
  });
  assert.equal(assistantError[0]?.type, 'assistant_error_message');
});

/**
 * This test covers helper-3 Codex normalization: user_message, reasoning fallback, tool request/success/error, todo plan updates.
 */
test('llmMessagesUnifier normalizes codex message categories', () => {
  const sessionId = 'codex-session-1';

  const user = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'event_msg',
    payload: {
      type: 'user_message',
      message: 'run command',
      local_images: ['a.png'],
      images: ['b.png'],
    },
  });
  assert.equal(user[0]?.type, 'user_message');
  assert.deepEqual(user[0]?.images, ['a.png', 'b.png']);

  const reasoning = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'response_item',
    payload: {
      type: 'reasoning',
      summary: [],
    },
  });
  assert.equal(reasoning[0]?.type, 'thinking_message');
  assert.equal(reasoning[0]?.text, 'Reasoning');

  const toolRequest = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'shell_command',
      arguments: '{"command":"echo hi"}',
      call_id: 'call_1',
    },
  });
  assert.equal(toolRequest[0]?.type, 'tool_use_request');

  const assistantMessage = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Command finished' }],
    },
  });
  assert.equal(assistantMessage[0]?.type, 'assistant_message');
  assert.equal(assistantMessage[0]?.text, 'Command finished');

  const todo = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'update_plan',
      arguments: '{"plan":[{"step":"A","status":"in_progress"}]}',
      call_id: 'call_2',
    },
  });
  assert.equal(todo[0]?.type, 'todo_task_list');
  assert.equal(todo[0]?.has_progress_indicator, true);

  const toolError = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'event_msg',
    payload: {
      type: 'exec_command_end',
      status: 'failed',
      call_id: 'call_3',
    },
  });
  assert.equal(toolError[0]?.type, 'tool_call_error');

  const toolSuccess = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: 'call_4',
      output: 'Exit code: 0\nWall time: 0.1 seconds',
    },
  });
  assert.equal(toolSuccess[0]?.type, 'tool_call_success');

  const interruptedTurn = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '<turn_aborted>\nInterrupted\n</turn_aborted>' }],
    },
  });
  assert.equal(interruptedTurn[0]?.type, 'session_interrupted');

  const payloadError = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'response_item',
    payload: {
      type: 'error',
      message: 'codex payload error',
    },
  });
  assert.equal(payloadError[0]?.type, 'assistant_error_message');

  const streamError = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    type: 'error',
    message: 'codex stream error',
  });
  assert.equal(streamError[0]?.type, 'assistant_error_message');
});

/**
 * This test covers helper-3 Gemini normalization from JSON history: user/assistant/thought/tool-call success and error.
 */
test('llmMessagesUnifier normalizes gemini history categories', () => {
  const sessionId = 'gemini-session-1';
  const messages = llmMessagesUnifier.normalizeUnknown('gemini', sessionId, {
    sessionId,
    messages: [
      {
        type: 'user',
        timestamp: '2026-04-01T10:00:00.000Z',
        content: [{ text: 'create files' }],
      },
      {
        type: 'gemini',
        timestamp: '2026-04-01T10:00:01.000Z',
        content: 'I will do it',
        thoughts: [{ subject: 'Planning', description: 'Thinking path' }],
        toolCalls: [
          { id: 't1', name: 'write_file', displayName: 'Write File', status: 'success' },
          { id: 't2', name: 'write_file', status: 'error' },
        ],
      },
    ],
  });

  assert.ok(messages.some((message) => message.type === 'user_message'));
  assert.ok(messages.some((message) => message.type === 'assistant_message'));
  assert.ok(messages.some((message) => message.type === 'thinking_message'));
  assert.ok(messages.some((message) => message.type === 'tool_call_success'));
  assert.ok(messages.some((message) => message.type === 'tool_call_error'));

  const assistantIndex = messages.findIndex((message) => message.type === 'assistant_message');
  const thinkingIndex = messages.findIndex((message) => message.type === 'thinking_message');
  assert.ok(assistantIndex >= 0);
  assert.ok(thinkingIndex > assistantIndex);

  const successfulTool = messages.find((message) => message.type === 'tool_call_success');
  assert.equal(successfulTool?.toolName, 'Write File');
});

/**
 * This test covers helper-3 Cursor normalization: strip user_query tags and parse CreatePlan as todo with no progress indicator.
 */
test('llmMessagesUnifier normalizes cursor categories and strips user_query tags', () => {
  const sessionId = 'cursor-session-1';
  const user = llmMessagesUnifier.normalizeUnknown('cursor', sessionId, {
    role: 'user',
    message: {
      content: [{ type: 'text', text: '<user_query>\nhello world\n</user_query>' }],
    },
  });
  assert.equal(user[0]?.type, 'user_message');
  assert.equal(user[0]?.text, 'hello world');

  const assistant = llmMessagesUnifier.normalizeUnknown('cursor', sessionId, {
    role: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Starting work' },
        {
          type: 'tool_use',
          name: 'CreatePlan',
          input: {
            todos: [{ id: '1', content: 'Do it' }],
          },
        },
        {
          type: 'tool_use',
          name: 'ApplyPatch',
          input: {
            patch: '*** Begin Patch',
          },
        },
      ],
    },
  });

  assert.ok(assistant.some((message) => message.type === 'assistant_message'));
  const todoMessage = assistant.find((message) => message.type === 'todo_task_list');
  assert.equal(todoMessage?.has_progress_indicator, false);
  assert.ok(assistant.some((message) => message.type === 'tool_call_success'));
});

/**
 * This test covers shared session status normalization: started/completed/interrupted payloads.
 */
test('llmMessagesUnifier normalizes shared session status events', () => {
  const sessionId = 'shared-session-1';
  const started = llmMessagesUnifier.normalizeUnknown('codex', sessionId, {
    sessionId,
    sessionStatus: 'STARTED',
  });
  assert.equal(started[0]?.type, 'session_started');

  const completed = llmMessagesUnifier.normalizeUnknown('gemini', sessionId, {
    sessionId,
    sessionStatus: 'COMPLETED',
  });
  assert.equal(completed[0]?.type, 'session_completed');

  const interrupted = llmMessagesUnifier.normalizeUnknown('claude', sessionId, {
    sessionId,
    sessionStatus: 'SESSION_ABORTED',
  });
  assert.equal(interrupted[0]?.type, 'session_interrupted');
});

/**
 * This test covers helper-3 notification flow: Claude permission callbacks should surface as tool_use_request.
 */
test('llmMessagesUnifier normalizes pre-unified tool_use_request payloads', () => {
  const sessionId = 'permission-session-1';
  const messages = llmMessagesUnifier.normalizeUnknown('claude', sessionId, {
    type: 'tool_use_request',
    toolName: 'Read',
    input: { filePath: 'notes.txt' },
    toolUseID: 'toolu_123',
    title: 'Claude wants to read notes.txt',
  });

  assert.equal(messages[0]?.type, 'tool_use_request');
  assert.equal(messages[0]?.toolName, 'Read');
  assert.equal(messages[0]?.toolCallId, 'toolu_123');
});

/**
 * This test covers helper-3 runtime-event fallback behavior for non-JSON stdout/stderr stream messages.
 */
test('llmMessagesUnifier normalizes fallback session events with channel-aware error typing', () => {
  const messages = llmMessagesUnifier.normalizeSessionEvents('gemini', 'runtime-session-1', [
    {
      timestamp: '2026-04-06T12:00:00.000Z',
      channel: 'stdout',
      message: 'Process started',
    },
    {
      timestamp: '2026-04-06T12:00:01.000Z',
      channel: 'error',
      message: 'Process failed',
    },
  ]);

  assert.equal(messages[0]?.type, 'assistant_message');
  assert.equal(messages[1]?.type, 'assistant_error_message');
});
