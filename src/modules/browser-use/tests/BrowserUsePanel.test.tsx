import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import BrowserUsePanel from '@/modules/browser-use/BrowserUsePanel';
import '@/modules/i18n';

const { sessions } = vi.hoisted(() => ({ sessions: vi.fn() }));

vi.mock('@/shared/api', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  api: {
    browserUse: {
      status: async () => Response.json({
        data: { enabled: true, available: true, playwrightInstalled: true, chromiumInstalled: true },
      }),
      sessions,
    },
  },
}));

afterEach(() => {
  vi.useRealTimers();
});

const stoppedSession = {
  id: 'old',
  title: 'Old browser',
  status: 'stopped',
  screenshotDataUrl: 'data:image/jpeg;base64,b2xk',
};
const activeSession = {
  id: 'active',
  title: 'New browser',
  status: 'ready',
  screenshotDataUrl: 'data:image/jpeg;base64,bmV3',
};

test('shows a newly opened browser without manual refresh and stops polling when hidden', async () => {
  vi.useFakeTimers();
  sessions.mockResolvedValueOnce(Response.json({ data: { sessions: [stoppedSession] } }));
  sessions.mockImplementation(async () => Response.json({ data: { sessions: [stoppedSession, activeSession] } }));

  const { rerender } = render(<BrowserUsePanel isVisible />);
  await act(async () => {});
  expect(screen.getByRole('img').getAttribute('src')).toBe(stoppedSession.screenshotDataUrl);

  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByRole('img').getAttribute('src')).toBe(activeSession.screenshotDataUrl);

  fireEvent.click(screen.getAllByRole('button', { name: 'Old browser' })[0]);
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByRole('img').getAttribute('src')).toBe(stoppedSession.screenshotDataUrl);

  rerender(<BrowserUsePanel isVisible={false} />);
  const previousCalls = sessions.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(sessions).toHaveBeenCalledTimes(previousCalls);
});
