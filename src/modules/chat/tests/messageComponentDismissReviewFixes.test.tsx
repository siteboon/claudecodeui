import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage } from '@/shared/types';

/**
 * A review fix on `MessageComponent`: the dismiss button's click handler
 * discarded `dismissSideQuestion`'s promise with `void`. When the DELETE
 * request fails at the network level, that promise rejects and nothing
 * handles it, so it becomes an unhandled rejection — which, left uncaught,
 * can crash a strict host or at least spam the console with no indication
 * of where it came from. The handler now attaches a `.catch` that logs the
 * error, matching how other request failures in this module are reported
 * (`console.error`).
 */

const SIDE_QUESTION_ID = 'sq-1';
const SESSION_ID = 'session-7';
const TIMESTAMP = '2026-10-26T12:00:00.000Z';

const question: ChatMessage = {
  id: `side-question-q-${SIDE_QUESTION_ID}`,
  type: 'user',
  content: 'what does this flag do?',
  timestamp: TIMESTAMP,
  transcriptAnchorId: 'anchor-1',
  sideQuestion: { sideQuestionId: SIDE_QUESTION_ID, sessionId: SESSION_ID, status: 'done' },
};

const answer: ChatMessage = {
  id: `side-question-a-${SIDE_QUESTION_ID}`,
  type: 'assistant',
  content: 'It skips the cache.',
  timestamp: TIMESTAMP,
  sideQuestion: { sideQuestionId: SIDE_QUESTION_ID, sessionId: SESSION_ID, status: 'done' },
};

const renderRows = () =>
  render(
    <UiPreferencesProvider>
      <MessageComponent message={question} prevMessage={null} createDiff={() => []} provider="claude" />
      <MessageComponent message={answer} prevMessage={question} createDiff={() => []} provider="claude" />
    </UiPreferencesProvider>,
  );

let unhandledRejections: unknown[] = [];
const onUnhandledRejection = (event: PromiseRejectionEvent) => {
  unhandledRejections.push(event.reason);
};

beforeEach(() => {
  unhandledRejections = [];
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network down');
  }));
});

afterEach(() => {
  window.removeEventListener('unhandledrejection', onUnhandledRejection);
  vi.unstubAllGlobals();
});

test('a failed dismiss request does not become an unhandled rejection', async () => {
  renderRows();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  const [dismiss] = screen.getAllByRole('button', { name: 'Dismiss' });
  assert.ok(dismiss, 'a side question can be dismissed');
  fireEvent.click(dismiss);

  await waitFor(() => {
    assert.ok(consoleError.mock.calls.length > 0, 'the failure is logged');
  });

  // Give any unhandled rejection a turn of the microtask queue to surface.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(unhandledRejections, [], 'the rejection was caught, not left unhandled');

  consoleError.mockRestore();
});
