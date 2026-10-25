import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchSessionsProvider, useWorkbenchSessions } from '@/modules/workbench-sessions/context/WorkbenchSessionsContext';

// A stable `t`, like the real hook: the provider's refresh callback depends on it.
const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT }) }));
vi.mock('@/shared/api', () => ({
  api: { workbench: { listSessions: () => Promise.resolve(new Response('{"success":true,"data":{"sessions":[]}}')) } },
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
