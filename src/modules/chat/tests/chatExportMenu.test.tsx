import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import ChatExportMenu from '@/modules/chat/transcript/ChatExportMenu';
import type { ChatMessage } from '@/shared/types';

/**
 * An export whose full transcript could not be loaded writes no file, so
 * without a word from the menu the click looked like it did nothing.
 */

const downloadTranscriptExport = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/modules/chat/utils/chatExport', () => ({ downloadTranscriptExport }));

const messages: ChatMessage[] = [{ type: 'user', content: 'hello', timestamp: '2026-08-24T09:00:00.000Z' } as ChatMessage];

const exportAsHtml = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Export conversation' }));
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Web page/ })); });
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  downloadTranscriptExport.mockClear();
});

describe('the export menu', () => {
  it('says so when the whole conversation could not be loaded, until the next attempt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onLoadFullTranscript = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(messages);
    render(
      <ChatExportMenu
        messages={messages}
        provider="claude"
        createDiff={() => []}
        onLoadFullTranscript={onLoadFullTranscript}
      />,
    );

    await exportAsHtml();

    expect(screen.getByRole('status').textContent).toBe('Couldn\'t load the whole conversation. Try again.');
    expect(downloadTranscriptExport).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();

    await exportAsHtml();

    expect(screen.getByRole('status').textContent).toBe('');
    expect(downloadTranscriptExport).toHaveBeenCalledTimes(1);
  });

  it('takes the message away after a few seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ChatExportMenu
        messages={messages}
        provider="claude"
        createDiff={() => []}
        onLoadFullTranscript={() => Promise.reject(new Error('offline'))}
      />,
    );

    await exportAsHtml();
    expect(screen.getByRole('status').textContent).not.toBe('');

    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });

    expect(screen.getByRole('status').textContent).toBe('');
  });
});
