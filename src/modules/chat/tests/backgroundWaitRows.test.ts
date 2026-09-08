import { describe, expect, it } from 'vitest';

import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import type { BackgroundWaitInfo, NormalizedMessage } from '@/shared/types';

const waitRow = (content: string, backgroundWait: BackgroundWaitInfo): NormalizedMessage => ({
  id: Math.random().toString(36).slice(2),
  sessionId: 's1',
  timestamp: '2026-01-01T00:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  role: 'assistant',
  content,
  backgroundWait,
} as NormalizedMessage);

const textRow = (content: string): NormalizedMessage => ({
  id: Math.random().toString(36).slice(2),
  sessionId: 's1',
  timestamp: '2026-01-01T00:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  role: 'assistant',
  content,
} as NormalizedMessage);

describe('background wait rows', () => {
  it('draws the row a held session produces, tasks and all', () => {
    const converted = normalizedToChatMessages([
      waitRow('Holding the session open for 2 background tasks · up to 30m', {
        phase: 'holding',
        tasks: [{ id: 't1', description: 'deploy watch' }, { id: 't2', description: 'log tail' }],
        ceilingMs: 1_800_000,
      }),
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0].backgroundWait?.phase).toBe('holding');
    expect(converted[0].backgroundWait?.tasks).toHaveLength(2);
  });

  it('keeps only the newest live row, since they describe a state and not events', () => {
    const converted = normalizedToChatMessages([
      waitRow('Running 1 background task', { phase: 'started' }),
      waitRow('Running 2 background tasks', { phase: 'started' }),
      waitRow('Holding the session open for 2 background tasks', { phase: 'holding' }),
    ]);

    expect(converted.map((message) => message.content))
      .toEqual(['Holding the session open for 2 background tasks']);
  });

  it('keeps a wait that has ended, which is history worth reading', () => {
    const converted = normalizedToChatMessages([
      waitRow('Running 1 background task', { phase: 'started' }),
      waitRow('Background work reported in after 2m 10s', { phase: 'reported' }),
      waitRow('Holding the session open for background work', { phase: 'holding' }),
    ]);

    expect(converted.map((message) => message.backgroundWait?.phase))
      .toEqual(['reported', 'holding']);
  });

  it('keeps an expired wait, which is the case nothing else reports', () => {
    const converted = normalizedToChatMessages([
      waitRow('Stopped waiting for background work after 30m', { phase: 'expired' }),
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0].backgroundWait?.phase).toBe('expired');
  });

  it("does not let a subagent's wait suppress this session's row", () => {
    const subagentWait: NormalizedMessage = {
      ...waitRow('Running 1 background task', { phase: 'started' }),
      parentToolUseId: 'toolu_1',
    } as NormalizedMessage;

    const converted = normalizedToChatMessages([
      waitRow('Holding the session open for background work', { phase: 'holding' }),
      subagentWait,
    ]);

    expect(converted.map((message) => message.content))
      .toEqual(['Holding the session open for background work']);
  });

  it('leaves every other row alone', () => {
    const converted = normalizedToChatMessages([
      textRow('before'),
      waitRow('Holding', { phase: 'holding' }),
      textRow('after'),
    ]);

    expect(converted.map((message) => message.content)).toEqual(['before', 'Holding', 'after']);
  });
});
