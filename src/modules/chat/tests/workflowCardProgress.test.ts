import { describe, expect, it } from 'vitest';

import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import type { NormalizedMessage } from '@/shared/types';

const launch: NormalizedMessage = {
  id: 'm1',
  sessionId: 's1',
  timestamp: '2026-09-18T16:38:30.000Z',
  provider: 'claude',
  kind: 'tool_use',
  toolName: 'Workflow',
  toolId: 'toolu_workflow',
  toolInput: { script: "export const meta = { name: 'check-seed' }" },
  toolResult: { content: 'Workflow launched in background. Task ID: w9njgonls', isError: false },
} as unknown as NormalizedMessage;

const progress = (fields: Partial<NormalizedMessage>): NormalizedMessage => ({
  id: `p_${String(fields.status ?? 'x')}`,
  sessionId: 's1',
  timestamp: '2026-09-18T16:40:00.000Z',
  provider: 'claude',
  kind: 'task_progress',
  toolId: 'toolu_workflow',
  ...fields,
} as unknown as NormalizedMessage);

describe('a running workflow card', () => {
  it('reads as running while the launch result already exists', () => {
    const [card] = normalizedToChatMessages([
      launch,
      progress({ status: 'in_progress', taskProgress: { toolUses: 17, lastToolName: 'Bash' } }),
    ]);

    expect(card.toolStatus).toBe('in_progress');
    expect(card.toolProgress).toEqual({ toolUses: 17, lastToolName: 'Bash' });
  });

  it('keeps the counters when a later frame only changes the status', () => {
    const [card] = normalizedToChatMessages([
      launch,
      progress({ status: 'in_progress', taskProgress: { toolUses: 17, lastToolName: 'Bash' } }),
      progress({ status: 'failed' }),
    ]);

    expect(card.toolStatus).toBe('failed');
    expect(card.toolProgress?.toolUses).toBe(17);
  });

  it('never renders a lifecycle frame as a row of its own', () => {
    const rows = normalizedToChatMessages([
      launch,
      progress({ status: 'in_progress', taskProgress: { toolUses: 3 } }),
    ]);

    expect(rows).toHaveLength(1);
  });
});
