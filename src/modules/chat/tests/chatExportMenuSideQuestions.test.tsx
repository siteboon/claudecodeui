import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, vi } from 'vitest';

import ChatExportMenu from '@/modules/chat/transcript/ChatExportMenu';
import type { ChatMessage } from '@/shared/types';
import type * as ReactI18nextModule from 'react-i18next';
import type * as ChatExportModule from '@/modules/chat/utils/chatExport';

/**
 * The export leaves BTW asides out unless the operator asks for them, and the
 * menu is where they ask: one option, off until it is turned on.
 *
 * Assumptions, kept minimal: labels render as their i18n keys (mocked below);
 * the option is reachable once the menu is open, its text is the key
 * `export.includeSideQuestions`, and its on/off state is readable as
 * `aria-checked` or a checkbox's `checked`.
 */

const downloadTranscriptExport = vi.fn();

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/modules/chat/utils/chatExport', async (importOriginal) => {
  const actual = await importOriginal<typeof ChatExportModule>();
  return { ...actual, downloadTranscriptExport: (...args: unknown[]) => downloadTranscriptExport(...args) };
});

const messages: ChatMessage[] = [{ id: 'm1', type: 'user', content: 'hello', timestamp: '2026-10-26T10:00:00.000Z' }];

const openMenu = () => {
  render(<ChatExportMenu messages={messages} sessionTitle="S" provider="claude" createDiff={() => []} />);
  fireEvent.click(screen.getByRole('button', { name: 'export.trigger' }));
  // The menu is open: its format items are on screen.
  screen.getByText('export.markdown.label');
};

const option = (): HTMLElement => {
  const label = screen.getByText('export.includeSideQuestions');
  const control = label.closest('[role="checkbox"], [role="switch"], [role="menuitemcheckbox"], label') ?? label;
  // A label may wrap its input or point at a sibling one through `htmlFor`.
  return (control instanceof HTMLLabelElement ? control.control ?? control : control) as HTMLElement;
};

const isOn = (el: HTMLElement): boolean => (
  el instanceof HTMLInputElement
    ? el.checked
    : el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true'
);

// One string per call, so a failure never prints the call list itself.
const includeFlags = () => downloadTranscriptExport.mock.calls.map(([, input]) => String((input as { includeSideQuestions?: unknown }).includeSideQuestions ?? false));

beforeEach(() => {
  downloadTranscriptExport.mockReset();
  downloadTranscriptExport.mockResolvedValue(undefined);
});

describe('ChatExportMenu side-question option', () => {
  it('offers the option, off by default, and exports without side questions', async () => {
    openMenu();

    assert.ok(!isOn(option()), 'the option starts off');

    await act(async () => { fireEvent.click(screen.getByText('export.markdown.label')); });
    await waitFor(() => assert.equal(downloadTranscriptExport.mock.calls.length, 1));
    assert.deepEqual(includeFlags(), ['false']);
  });

  it('turned on, the export input carries includeSideQuestions: true', async () => {
    openMenu();

    await act(async () => { fireEvent.click(option()); });
    if (!screen.queryByText('export.markdown.label')) {
      fireEvent.click(screen.getByRole('button', { name: 'export.trigger' }));
    }
    assert.ok(isOn(option()), 'the option is on after a click');

    await act(async () => { fireEvent.click(screen.getByText('export.markdown.label')); });
    await waitFor(() => assert.equal(downloadTranscriptExport.mock.calls.length, 1));
    assert.deepEqual(includeFlags(), ['true']);
  });
});
