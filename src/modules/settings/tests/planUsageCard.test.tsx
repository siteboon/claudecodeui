import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import PlanUsageCard from '@/modules/settings/PlanUsageCard';

const usage = vi.hoisted(() => ({
  provider: '' as string,
  refresh: vi.fn(),
}));

vi.mock('@/modules/settings/hooks/usePlanUsage', () => ({
  usePlanUsage: (provider: string) => {
    usage.provider = provider;
    return {
      usage: {
        available: true,
        fiveHour: { utilization: 42, resetsAt: '2026-10-25T12:00:00Z' },
        sevenDay: { utilization: 17, resetsAt: '2026-10-29T12:00:00Z' },
      },
      loading: false,
      refresh: usage.refresh,
    };
  },
}));

beforeEach(() => usage.refresh.mockClear());

it.each(['claude', 'codex'] as const)('shows %s account limits and refreshes them', (provider) => {
  render(<PlanUsageCard provider={provider} />);

  expect(usage.provider).toBe(provider);
  expect(screen.getByText('5-hour')).toBeTruthy();
  expect(screen.getByText('Week')).toBeTruthy();
  expect(screen.getByText('42%')).toBeTruthy();
  expect(screen.getByText('17%')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Click to refresh' }));
  expect(usage.refresh).toHaveBeenCalledOnce();
});
