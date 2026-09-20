import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { DailyReport } from '@/shared/types';

const report: DailyReport = {
  id: 'report-1',
  date: '2026-09-20',
  timezone: 'Asia/Shanghai',
  locale: 'en',
  generatedAt: '2026-09-20T10:00:01.000Z',
  snapshotAt: '2026-09-20T10:00:00.000Z',
  summaryProvider: 'claude',
  mode: 'ai',
  coverage: { projectCount: 1, sessionCount: 9, partial: false, warnings: [] },
  highlights: ['Implemented the report.', 'Verified the result.'],
  items: Array.from({ length: 9 }, (_, index) => ({
    id: `item-${index + 1}`,
    projectId: 'project-1',
    projectName: 'CloudCLI',
    task: `Task ${index + 1}`,
    progress: `Result ${index + 1}`,
    nextStep: `Next ${index + 1}`,
    status: 'progress' as const,
    sources: [{ provider: 'codex' as const, sessionId: `session-${index + 1}`, evidenceId: `e-${index + 1}` }],
  })),
};

let availableProviders: Array<'claude' | 'codex'> = ['claude', 'codex'];

vi.mock('@/modules/daily-report/hooks/useDailyReport', () => ({
  useDailyReport: (open: boolean, locale: string, summaryProvider: 'claude' | 'codex') => ({
    report: open ? { ...report, locale, summaryProvider } : null,
    isLoading: false,
    isGenerating: false,
    error: null,
    timezone: 'Asia/Shanghai',
    generate: vi.fn(),
  }),
  useDailyReportProviderAvailability: () => ({
    availableProviders,
    isCheckingProviders: false,
  }),
}));

const { DailyReportDialog } = await import('@/modules/daily-report/DailyReportDialog');

test('shows eight items by default and reveals the remaining items on request', () => {
  window.localStorage.clear();
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DailyReportDialog open onOpenChange={() => undefined} />
      </MemoryRouter>
    </I18nextProvider>,
  );

  assert.ok(screen.getByText(/Task 8$/));
  assert.equal(screen.queryByText(/Task 9$/), null);
  fireEvent.click(screen.getByText('Show 1 more'));
  assert.ok(screen.getByText(/Task 9$/));
});

test('switches the report content and dialog labels to Simplified Chinese', () => {
  window.localStorage.clear();
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DailyReportDialog open onOpenChange={() => undefined} />
      </MemoryRouter>
    </I18nextProvider>,
  );

  fireEvent.change(screen.getByLabelText('Report language'), { target: { value: 'zh-CN' } });
  assert.ok(screen.getByText(/做的事情: Task 1$/));
  assert.equal(window.localStorage.getItem('cloudcli.dailyReport.locale'), 'zh-CN');
});

test('offers common report languages and renders summary highlights as a list', () => {
  window.localStorage.clear();
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DailyReportDialog open onOpenChange={() => undefined} />
      </MemoryRouter>
    </I18nextProvider>,
  );

  const language = screen.getByLabelText('Report language') as HTMLSelectElement;
  assert.equal(language.options.length, 10);
  assert.ok(screen.getByText('Implemented the report.').closest('li'));
  assert.ok(screen.getByText('Verified the result.').closest('li'));
});

test('allows selecting Codex and remembers the provider', () => {
  availableProviders = ['claude', 'codex'];
  window.localStorage.clear();
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DailyReportDialog open onOpenChange={() => undefined} />
      </MemoryRouter>
    </I18nextProvider>,
  );

  fireEvent.change(screen.getByLabelText('Summary provider'), { target: { value: 'codex' } });
  assert.equal(window.localStorage.getItem('cloudcli.dailyReport.summaryProvider'), 'codex');
});

test('defaults to Codex when Claude is not configured', async () => {
  availableProviders = ['codex'];
  window.localStorage.clear();
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DailyReportDialog open onOpenChange={() => undefined} />
      </MemoryRouter>
    </I18nextProvider>,
  );

  await waitFor(() => {
    assert.equal((screen.getByLabelText('Summary provider') as HTMLSelectElement).value, 'codex');
  });
  assert.ok(screen.getByText('Claude is unavailable; using local Codex configuration'));
});

test('explains when neither Claude nor Codex is configured', () => {
  availableProviders = [];
  window.localStorage.clear();
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DailyReportDialog open onOpenChange={() => undefined} />
      </MemoryRouter>
    </I18nextProvider>,
  );

  assert.ok(screen.getByRole('alert'));
  assert.ok(screen.getByText(/No installed and signed-in Claude Code or Codex CLI was found/));
  assert.equal(screen.getByText('Generate report').closest('button')?.hasAttribute('disabled'), true);
});
