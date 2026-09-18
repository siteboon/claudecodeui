import { describe, expect, it } from 'vitest';

import { mergeTaskProgress, supersedeTaskProgress } from '@/modules/chat/hooks/useSessionStore';
import type { NormalizedMessage } from '@/shared/types';

const row = (id: string, fields: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  id,
  sessionId: 's1',
  timestamp: '2026-09-18T16:40:00.000Z',
  provider: 'claude',
  kind: 'task_progress',
  toolId: 'toolu_workflow',
  ...fields,
} as unknown as NormalizedMessage);

const text = row('t1', { kind: 'text', role: 'assistant', content: 'hello', toolId: undefined });

describe('repeated progress reports', () => {
  it('replace the row they supersede instead of stacking up', () => {
    const existing = [text, row('p1', { taskProgress: { toolUses: 4 } })];

    expect(supersedeTaskProgress(existing, row('p2', { taskProgress: { toolUses: 9 } })))
      .toEqual([text]);
  });

  it('leave rows for another run alone', () => {
    const other = row('p1', { toolId: 'toolu_other', taskProgress: { toolUses: 4 } });

    expect(supersedeTaskProgress([other], row('p2'))).toEqual([other]);
  });

  it('carry forward what the replaced row knew', () => {
    const existing = [row('p1', { status: 'in_progress', taskProgress: { toolUses: 9, lastToolName: 'Bash' } })];
    const merged = mergeTaskProgress(existing, row('p2', { status: 'failed' }));

    expect(merged.taskProgress).toEqual({ toolUses: 9, lastToolName: 'Bash' });
    expect(merged.status).toBe('failed');
  });

  it('leave every other kind of message untouched', () => {
    expect(supersedeTaskProgress([text], text)).toEqual([text]);
    expect(mergeTaskProgress([text], text)).toBe(text);
  });
});
