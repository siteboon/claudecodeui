/**
 * Real tests for KiroSessionsProvider.
 *
 * Exercises normalizeMessage against verified Kiro JSONL event shapes (Prompt,
 * AssistantMessage with text + toolUse mix, ToolResults with status:'success'
 * vs status:'error'). Fixture data was captured from a real `kiro-cli acp`
 * session against `/tmp` on 2026-05-12.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { KiroSessionsProvider } from '@/modules/providers/list/kiro/kiro-sessions.provider.js';

const PROVIDER = 'kiro';

describe('KiroSessionsProvider.normalizeMessage', () => {
  const provider = new KiroSessionsProvider();

  it('normalizes a Prompt entry to a single user text message', () => {
    const entry = {
      version: 'v1',
      kind: 'Prompt',
      data: {
        message_id: 'p1',
        content: [{ kind: 'text', data: 'hello world' }],
        meta: { timestamp: 1778546781 },
      },
    };

    const messages = provider.normalizeMessage(entry, 'session-1');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].kind, 'text');
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, 'hello world');
    assert.equal(messages[0].provider, PROVIDER);
    assert.equal(messages[0].sessionId, 'session-1');
    // meta.timestamp is unix seconds; we should produce ISO 8601
    assert.match(messages[0].timestamp, /^2026-/);
  });

  it('normalizes an AssistantMessage with text + toolUse content to two messages', () => {
    const entry = {
      version: 'v1',
      kind: 'AssistantMessage',
      data: {
        message_id: 'a1',
        content: [
          { kind: 'text', data: 'I will call a tool now.' },
          {
            kind: 'toolUse',
            data: {
              toolUseId: 'tool-call-1',
              name: 'fs_read',
              input: { operations: [{ mode: 'Directory', path: '/tmp' }] },
            },
          },
        ],
      },
    };

    const messages = provider.normalizeMessage(entry, 'session-1');
    assert.equal(messages.length, 2);

    assert.equal(messages[0].kind, 'text');
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].content, 'I will call a tool now.');

    assert.equal(messages[1].kind, 'tool_use');
    assert.equal(messages[1].toolName, 'fs_read');
    assert.equal(messages[1].toolId, 'tool-call-1');
    assert.deepEqual(messages[1].toolInput, { operations: [{ mode: 'Directory', path: '/tmp' }] });
  });

  it('marks ToolResults with status="error" as isError=true', () => {
    const entry = {
      version: 'v1',
      kind: 'ToolResults',
      data: {
        message_id: 'r1',
        status: 'error',
        content: [
          {
            kind: 'toolResult',
            data: {
              toolUseId: 'tool-call-1',
              content: [{ kind: 'text', data: 'command exited 1' }],
            },
          },
        ],
      },
    };

    const messages = provider.normalizeMessage(entry, 'session-1');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].kind, 'tool_result');
    assert.equal(messages[0].isError, true);
    assert.equal(messages[0].content, 'command exited 1');
    assert.equal(messages[0].toolId, 'tool-call-1');
  });

  it('marks ToolResults with status="success" as isError=false', () => {
    const entry = {
      version: 'v1',
      kind: 'ToolResults',
      data: {
        message_id: 'r2',
        status: 'success',
        content: [
          {
            kind: 'toolResult',
            data: {
              toolUseId: 'tool-call-2',
              content: [{ kind: 'text', data: 'ok' }],
            },
          },
        ],
      },
    };

    const messages = provider.normalizeMessage(entry, 'session-1');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].isError, false);
  });

  it('falls back to per-content error kinds when status is missing', () => {
    const entry = {
      version: 'v1',
      kind: 'ToolResults',
      data: {
        message_id: 'r3',
        // no status field — exercise the content-part fallback
        content: [
          {
            kind: 'toolResult',
            data: {
              toolUseId: 'tool-call-3',
              content: [{ kind: 'errorText', data: 'something went wrong' }],
            },
          },
        ],
      },
    };

    const messages = provider.normalizeMessage(entry, 'session-1');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].isError, true);
    assert.equal(messages[0].content, 'something went wrong');
  });

  it('drops Prompt entries with empty/whitespace content', () => {
    const entry = {
      version: 'v1',
      kind: 'Prompt',
      data: {
        message_id: 'p2',
        content: [{ kind: 'text', data: '   \n\t' }],
        meta: { timestamp: 1778546781 },
      },
    };

    const messages = provider.normalizeMessage(entry, 'session-1');
    assert.equal(messages.length, 0);
  });

  it('returns [] for unknown kind', () => {
    const entry = {
      version: 'v1',
      kind: 'UnknownEventType',
      data: { message_id: 'x' },
    };

    assert.equal(provider.normalizeMessage(entry, 'session-1').length, 0);
  });

  it('returns [] for non-object input', () => {
    assert.equal(provider.normalizeMessage(null, 'session-1').length, 0);
    assert.equal(provider.normalizeMessage('string', 'session-1').length, 0);
    assert.equal(provider.normalizeMessage(42, 'session-1').length, 0);
  });

  it('produces unique ids when an entry has multiple text or tool parts', () => {
    // Regression: when CodeRabbit flagged this, an AssistantMessage with two
    // text parts produced two messages with the same `id` (both `${baseId}_text`),
    // breaking React keyed rendering and message-association lookups.
    const entry = {
      version: 'v1',
      kind: 'AssistantMessage',
      data: {
        message_id: 'a-multi',
        content: [
          { kind: 'text', data: 'first chunk' },
          { kind: 'text', data: 'second chunk' },
          {
            kind: 'toolUse',
            data: { toolUseId: 'tu1', name: 'fs_read', input: { path: '/a' } },
          },
          {
            kind: 'toolUse',
            data: { toolUseId: 'tu2', name: 'fs_read', input: { path: '/b' } },
          },
        ],
      },
    };

    const messages = provider.normalizeMessage(entry, 'session-1');
    const ids = messages.map((m) => m.id);
    assert.equal(messages.length, 4);
    assert.equal(new Set(ids).size, 4, `all ids must be unique; got: ${ids.join(', ')}`);
  });

  it('produces unique ids when ToolResults has multiple toolResult parts', () => {
    const entry = {
      version: 'v1',
      kind: 'ToolResults',
      data: {
        message_id: 'r-multi',
        status: 'success',
        content: [
          {
            kind: 'toolResult',
            data: {
              toolUseId: 'shared-tool-id',
              content: [{ kind: 'text', data: 'first result' }],
            },
          },
          {
            kind: 'toolResult',
            data: {
              toolUseId: 'shared-tool-id',
              content: [{ kind: 'text', data: 'second result' }],
            },
          },
        ],
      },
    };

    const messages = provider.normalizeMessage(entry, 'session-1');
    const ids = messages.map((m) => m.id);
    assert.equal(messages.length, 2);
    assert.equal(new Set(ids).size, 2, `tool_result ids must differ even when toolUseId collides; got: ${ids.join(', ')}`);
  });
});
