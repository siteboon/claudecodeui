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

const boundary = () => row({
  content: 'Compacted · manual · 335k → 10k tokens · 2m 22s',
  compact: { phase: 'done', trigger: 'manual', preTokens: 335_000, postTokens: 10_000 },
});
const summary = () => row({ content: 'The summary body', isCompactSummary: true });

describe('compaction rows', () => {
  it('folds the summary into the boundary that precedes it, as history orders them', () => {
    const converted = normalizedToChatMessages([boundary(), summary()]);

    expect(converted).toHaveLength(1);
    expect(converted[0].content).toBe('Compacted · manual · 335k → 10k tokens · 2m 22s');
    expect(converted[0].compactSummary).toBe('The summary body');
  });

  it('folds it into the boundary that follows it, as the live stream orders them', () => {
    const converted = normalizedToChatMessages([summary(), boundary()]);

    expect(converted).toHaveLength(1);
    expect(converted[0].content).toBe('Compacted · manual · 335k → 10k tokens · 2m 22s');
    expect(converted[0].compactSummary).toBe('The summary body');
  });

  it('draws a summary with no boundary of its own as a compaction all the same', () => {
    const converted = normalizedToChatMessages([summary()]);

    expect(converted).toHaveLength(1);
    expect(converted[0].compact?.phase).toBe('done');
    expect(converted[0].compactSummary).toBe('The summary body');
  });

  it('drops the unflagged second copy of a summary, before or after the flagged one', () => {
    const loose = () => row({ content: 'The summary body' });

    expect(normalizedToChatMessages([boundary(), summary(), loose()])).toHaveLength(1);
    expect(normalizedToChatMessages([loose(), row({ content: 'work' }), boundary(), summary()]))
      .toMatchObject([{ content: 'work' }, { compactSummary: 'The summary body' }]);
  });

  it("drops the CLI's one-word acknowledgement beside a real row, and keeps it without one", () => {
    expect(normalizedToChatMessages([row({ content: 'Compacted' }), boundary()]))
      .toMatchObject([{ content: 'Compacted · manual · 335k → 10k tokens · 2m 22s' }]);
    expect(normalizedToChatMessages([row({ content: 'Compacted' })]))
      .toMatchObject([{ content: 'Compacted' }]);
  });

  it('leaves a message that merely mentions the word alone', () => {
    const converted = normalizedToChatMessages([
      row({ content: 'Compacted the log file for you' }),
      boundary(),
    ]);

    expect(converted.map((message) => message.content)).toEqual([
      'Compacted the log file for you',
      'Compacted · manual · 335k → 10k tokens · 2m 22s',
    ]);
  });

  it('replaces the running row with the row that says how it ended', () => {
    const running = () => row({ content: 'Compacting conversation…', compact: { phase: 'running' } });

    expect(normalizedToChatMessages([running(), boundary()]))
      .toMatchObject([{ compact: { phase: 'done' } }]);

    const failed = row({
      content: 'Compaction failed: context still too large',
      compact: { phase: 'failed', error: 'context still too large' },
    });
    expect(normalizedToChatMessages([running(), failed]))
      .toMatchObject([{ compact: { phase: 'failed' } }]);
  });

  it('keeps the summary when it folded into a running row the boundary then replaced', () => {
    const converted = normalizedToChatMessages([
      row({ content: 'Compacting conversation…', compact: { phase: 'running' } }),
      summary(),
      boundary(),
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0].compact?.phase).toBe('done');
    expect(converted[0].compactSummary).toBe('The summary body');
  });

  it('leaves an earlier compaction alone: only the row directly above is superseded', () => {
    const converted = normalizedToChatMessages([
      summary(),
      row({ content: 'on with the work' }),
      boundary(),
    ]);

    expect(converted).toHaveLength(3);
    expect(converted[0].compactSummary).toBe('The summary body');
    expect(converted[1].content).toBe('on with the work');
    expect(converted[2].compactSummary).toBeUndefined();
  });

  it('never takes a user row for a stray copy of the summary', () => {
    const userEcho: NormalizedMessage = {
      ...row({ content: 'The summary body' }),
      role: 'user',
    } as NormalizedMessage;

    const converted = normalizedToChatMessages([userEcho, boundary(), summary()]);

    expect(converted.map((message) => message.type)).toEqual(['user', 'assistant']);
    expect(converted[1].compactSummary).toBe('The summary body');
  });

  it('keeps a running compaction, and its phase, so the row can say so', () => {
    const converted = normalizedToChatMessages([
      row({ content: 'Compacting conversation…', compact: { phase: 'running' } }),
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0].compact?.phase).toBe('running');
  });
});

describe('compaction rows and the projection cache', () => {
  it('does not mutate the row it folds into, since that row can be shared', () => {
    const boundaryRow = boundary();
    const first = normalizedToChatMessages([boundaryRow]);
    const firstRow = first[0];

    const second = normalizedToChatMessages([boundaryRow, summary()]);

    // The row handed back by the earlier pass is untouched; the fold produced a
    // new one, which is what makes a memoized row redraw.
    expect(firstRow.compactSummary).toBeUndefined();
    expect(second[0].compactSummary).toBe('The summary body');
    expect(second[0]).not.toBe(firstRow);
  });
});
