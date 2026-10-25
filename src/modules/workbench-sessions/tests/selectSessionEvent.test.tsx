import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchSessionsProvider, useWorkbenchSessions } from '@/modules/workbench-sessions/context/WorkbenchSessionsContext';

// A stable `t`, like the real hook: the provider's refresh callback depends on it.
const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT }) }));
vi.mock('@/shared/api', () => ({
  api: {
    workbench: {
      listSessions: () => Promise.resolve(new Response('{"success":true,"data":{"sessions":[]}}')),
      agentProposals: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: { proposals: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'approved' }] },
            }),
          ),
        ),
    },
  },
  readApiJson: async (response: Response) => response.json(),
}));

function Probe({ onValue }: { onValue: (id: string | null) => void }) {
  const { selectedSessionId } = useWorkbenchSessions();
  onValue(selectedSessionId);
  return null;
}

describe('workbench:select-session window event', () => {
  it('selects the session named in the event detail and ignores bad details', async () => {
    const seen: Array<string | null> = [];
    render(
      <WorkbenchSessionsProvider>
        <Probe onValue={(id) => seen.push(id)} />
      </WorkbenchSessionsProvider>,
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent('workbench:select-session', { detail: 'abc-123' }));
    });
    expect(seen[seen.length - 1]).toBe('abc-123');

    await act(async () => {
      window.dispatchEvent(new CustomEvent('workbench:select-session', { detail: 42 }));
    });
    expect(seen[seen.length - 1]).toBe('abc-123');
  });
});

function AgentAccessProbe({ onValue }: { onValue: (state: { open: boolean; pending: number }) => void }) {
  const { isAgentAccessOpen, pendingProposalCount } = useWorkbenchSessions();
  onValue({ open: isAgentAccessOpen, pending: pendingProposalCount });
  return null;
}

describe('agent access state', () => {
  it('counts pending proposals and opens on the workbench:open-proposals event', async () => {
    const seen: Array<{ open: boolean; pending: number }> = [];
    render(
      <WorkbenchSessionsProvider>
        <AgentAccessProbe onValue={(state) => seen.push(state)} />
      </WorkbenchSessionsProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(seen[seen.length - 1]).toEqual({ open: false, pending: 1 });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('workbench:open-proposals'));
    });
    expect(seen[seen.length - 1].open).toBe(true);
  });
});
