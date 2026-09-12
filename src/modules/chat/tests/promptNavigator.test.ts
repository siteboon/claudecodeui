import assert from 'node:assert/strict';

import { test } from 'vitest';

import { buildPromptEntries, buildPromptPreview } from '@/modules/chat/utils/promptNavigator';
import type { ChatMessage } from '@/shared/types';

/**
 * The prompt navigator rail offers one tick per user prompt. Messages that
 * never appear as a prompt bubble (assistant replies, thinking placeholders,
 * content-less local commands) must not produce entries, and the preview must
 * be a single readable line regardless of what the raw markdown looked like.
 */

const message = (partial: Partial<ChatMessage> & { type: string }): ChatMessage => ({
  timestamp: '2026-01-01T00:00:00.000Z',
  ...partial,
});

test('collects only user prompts, in order', () => {
  const entries = buildPromptEntries([
    message({ type: 'user', content: '第一条', timestamp: '2026-01-01T00:00:01.000Z' }),
    message({ type: 'assistant', content: '回复' }),
    message({ type: 'user', isThinking: true, content: '思考中' }),
    message({ type: 'user', isLocalCommand: true }),
    message({ type: 'user', content: '/help 用法说明', isLocalCommand: true }),
    message({ type: 'user', content: '第二条', timestamp: '2026-01-01T00:00:09.000Z' }),
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.preview),
    ['第一条', '/help 用法说明', '第二条'],
  );
  assert.equal(entries[0].timestamp, '2026-01-01T00:00:01.000Z');
  assert.equal(entries[1].message.isLocalCommand, true);
  // Ids stay unique even when two prompts share a timestamp.
  const dup = buildPromptEntries([
    message({ type: 'user', content: '甲', timestamp: '2026-01-01T00:00:05.000Z' }),
    message({ type: 'user', content: '乙', timestamp: '2026-01-01T00:00:05.000Z' }),
  ]);
  assert.notEqual(dup[0].id, dup[1].id);
});

test('preview collapses markdown to one line', () => {
  assert.equal(
    buildPromptPreview('## 标题\n\n```js\nconst a = 1;\n```\n\n看 [链接](http://x.y) 里的 `_代码_`'),
    '标题 看 链接 里的 代码',
  );
  const long = buildPromptPreview('长'.repeat(400));
  assert.ok(long.length <= 160);
  assert.ok(long.endsWith('…'));
});
