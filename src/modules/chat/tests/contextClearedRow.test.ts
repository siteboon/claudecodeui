import { describe, expect, it } from 'vitest';

import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import type { NormalizedMessage } from '@/shared/types';

const row = (fields: Partial<NormalizedMessage>): NormalizedMessage => ({
  id: fields.id || Math.random().toString(36).slice(2),
  sessionId: 's1',
  timestamp: '2026-01-01T00:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  role: 'assistant',
  ...fields,
} as NormalizedMessage);

describe('context-cleared row', () => {
  it('stays a row of its own, flagged, between the two parts of the conversation', () => {
    const converted = normalizedToChatMessages([
      row({ role: 'user', content: 'before' }),
      row({ content: 'reply before' }),
      row({ id: 'context_cleared_first', content: 'Context cleared', contextCleared: true }),
      row({ role: 'user', content: 'after', transcriptAnchorId: 'anchor-after' }),
    ]);

    expect(converted.map((message) => message.content)).toEqual([
      'before',
      'reply before',
      'Context cleared',
      'after',
    ]);
    expect(converted.map((message) => Boolean(message.contextCleared))).toEqual([false, false, true, false]);
    // Only the part the session still runs on can be edited or forked from.
    expect(converted[0].transcriptAnchorId).toBeUndefined();
    expect(converted[3].transcriptAnchorId).toBe('anchor-after');
  });
});
