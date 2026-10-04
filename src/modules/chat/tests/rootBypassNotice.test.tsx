import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/modules/i18n';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, NormalizedMessage } from '@/shared/types';

// When the server runs as root, Claude Code refuses bypass-permissions mode,
// so the turn runs with approvals and the server adds an error row saying why
// (#641). The row's text is the English fallback; `noticeCode` is what lets
// the reader see it in their own language, and drawn as a note rather than
// as an Error, since the turn itself goes on.
const ENGLISH_FALLBACK = 'Bypass permissions was not applied (server text)';

const noticeRow: NormalizedMessage = {
  id: 'notice-1',
  sessionId: 'session-1',
  timestamp: '2026-10-04T12:00:00.000Z',
  provider: 'claude',
  kind: 'error',
  content: ENGLISH_FALLBACK,
  noticeCode: 'claude_bypass_refused_as_root',
};

const renderMessage = (message: ChatMessage, prevMessage: ChatMessage | null = null) =>
  render(
    <UiPreferencesProvider>
      <MessageComponent message={message} prevMessage={prevMessage} createDiff={() => []} provider="claude" />
    </UiPreferencesProvider>,
  );

describe('the root bypass notice in the transcript', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('is drawn in the reader language instead of the server text', async () => {
    await i18n.changeLanguage('de');
    const [message] = normalizedToChatMessages([noticeRow]);
    expect(message?.noticeCode).toBe('claude_bypass_refused_as_root');

    renderMessage(message!);

    expect(screen.getByText(/Berechtigungen umgehen wurde nicht angewendet/)).toBeTruthy();
    expect(screen.queryByText(ENGLISH_FALLBACK)).toBeNull();
  });

  it('is drawn as a note, without the Error header and badge', () => {
    const [message] = normalizedToChatMessages([noticeRow]);

    renderMessage(message!);

    expect(screen.getByText(/^Bypass permissions was not applied: CloudCLI is running as root/)).toBeTruthy();
    expect(screen.queryByText('Error')).toBeNull();
    expect(screen.queryByText('!')).toBeNull();
  });

  it('does not swallow the header of an error that follows it', () => {
    const [notice, error] = normalizedToChatMessages([
      noticeRow,
      { ...noticeRow, id: 'error-1', content: 'Claude Code process exited with code 1', noticeCode: undefined },
    ]);

    renderMessage(error!, notice!);

    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('Claude Code process exited with code 1')).toBeTruthy();
  });

  it('leaves other error rows as the server wrote them', () => {
    const [message] = normalizedToChatMessages([
      { ...noticeRow, id: 'error-1', content: 'Claude Code process exited with code 1', noticeCode: undefined },
    ]);

    renderMessage(message!);

    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('Claude Code process exited with code 1')).toBeTruthy();
  });
});
