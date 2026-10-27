import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, SideQuestionStatus } from '@/shared/types';

/**
 * A side question is drawn where it was asked, marked as an aside: a label
 * that says it is not part of the session, the answer shimmering until text
 * arrives, the failure when it failed, and a way to dismiss it. It cannot be
 * edited or forked from — the session never saw it, so there is nothing to
 * re-run from there.
 */

const SIDE_QUESTION_ID = 'sq-1';
const SESSION_ID = 'session-7';
const TIMESTAMP = '2026-10-26T12:00:00.000Z';

const question = (status: SideQuestionStatus, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `side-question-q-${SIDE_QUESTION_ID}`,
  type: 'user',
  content: 'what does this flag do?',
  timestamp: TIMESTAMP,
  // An anchor is what would make the edit and fork controls appear on an
  // ordinary user row; a side question must not show them even so.
  transcriptAnchorId: 'anchor-1',
  sideQuestion: { sideQuestionId: SIDE_QUESTION_ID, sessionId: SESSION_ID, status },
  ...overrides,
});

const answer = (status: SideQuestionStatus, content: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `side-question-a-${SIDE_QUESTION_ID}`,
  type: 'assistant',
  content,
  timestamp: TIMESTAMP,
  isStreaming: status === 'running',
  sideQuestion: { sideQuestionId: SIDE_QUESTION_ID, sessionId: SESSION_ID, status },
  ...overrides,
});

// Absence is asserted as `query(...) === null`, never `assert.equal(node, null)`:
// on failure node:assert inspects the DOM node with React's fiber attached,
// which took 6.6 GB and then the machine's whole heap (measured 2026-10-26).

const onEditMessage = vi.fn();
const onForkFromMessage = vi.fn();

const renderRows = (rows: ChatMessage[]) =>
  render(
    <UiPreferencesProvider>
      {rows.map((message, index) => (
        <MessageComponent
          key={String(message.id ?? index)}
          message={message}
          prevMessage={index > 0 ? rows[index - 1] ?? null : null}
          createDiff={() => []}
          provider="claude"
          onEditMessage={onEditMessage}
          onForkFromMessage={onForkFromMessage}
        />
      ))}
    </UiPreferencesProvider>,
  );

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
});

afterEach(() => {
  // Rendering a side question must not log: a React key or prop warning
  // here is a bug in the row, not noise.
  // Compared as short strings: a deep diff of React's logged arguments
  // (fibers, cyclic) exhausts the heap instead of failing.
  const logged = consoleError.mock.calls.map((args) => String(args[0]).slice(0, 200));
  consoleError.mockRestore();
  assert.equal(logged.length, 0, `nothing was logged to console.error, got: ${logged.join(' | ')}`);
  vi.unstubAllGlobals();
  onEditMessage.mockReset();
  onForkFromMessage.mockReset();
});

test('the question carries the aside label', () => {
  renderRows([question('done'), answer('done', 'It skips the cache.')]);

  assert.ok(screen.getByText('Side question · not part of the session'));
  assert.ok(screen.getByText('what does this flag do?'));
  assert.ok(screen.getByText('It skips the cache.'));
});

test('while running with no answer yet, the answer shimmers with the pending text', () => {
  const { container } = renderRows([question('running'), answer('running', '')]);

  const pending = screen.getByText('Answering on the side');
  assert.ok(pending.closest('.animate-shimmer') ?? container.querySelector('.animate-shimmer'), 'drawn with the shared Shimmer');
  assert.ok(container.querySelector('.animate-shimmer')?.textContent?.includes('Answering on the side'));
});

test('once answer text has arrived, the pending shimmer is gone', () => {
  renderRows([question('running'), answer('running', 'It skips')]);

  assert.ok(screen.queryByText('Answering on the side') === null, 'no pending shimmer once text has arrived');
  assert.ok(screen.getByText(/It skips/));
});

test('a failed side question shows its error', () => {
  // The merge writes the answer so far followed by the error in italics.
  renderRows([question('error'), answer('error', 'It skips\n\n*The fork exited with code 1*')]);

  const error = screen.getByText('The fork exited with code 1');
  assert.ok(error.closest('em'), 'the error is set apart in italics');
  assert.ok(screen.queryByText('Answering on the side') === null, 'no pending shimmer on a failed side question');
  // Markdown alone already draws the italics; these make the test about the aside.
  assert.ok(screen.queryByText('Side question · not part of the session') !== null, 'a failed pair is still marked as an aside');
  assert.ok(screen.queryAllByRole('button', { name: 'Dismiss' }).length > 0, 'and can still be dismissed');
});

test('no edit or fork control on either row of a side question', () => {
  renderRows([question('done'), answer('done', 'It skips the cache.')]);

  assert.ok(screen.queryByRole('button', { name: 'Edit and resend' }) === null, 'no edit control');
  assert.ok(screen.queryByRole('button', { name: 'Fork from here' }) === null, 'no fork control');
});

test('an ordinary user row with the same anchor does show them (so the test above can fail)', () => {
  renderRows([question('done', { sideQuestion: undefined, id: 'plain-1' })]);

  assert.ok(screen.getByRole('button', { name: 'Edit and resend' }));
  assert.ok(screen.getByRole('button', { name: 'Fork from here' }));
  assert.ok(screen.queryByText('Side question · not part of the session') === null, 'an ordinary row carries no aside label');
});

test('the pair is one aside: a single label and a single dismiss control, both on the question', () => {
  const { container } = renderRows([question('done'), answer('done', 'It skips the cache.')]);

  assert.equal(screen.getAllByText('Side question · not part of the session').length, 1, 'one label for the pair');
  assert.equal(screen.getAllByRole('button', { name: 'Dismiss' }).length, 1, 'one dismiss control for the pair');
  const rows = container.querySelectorAll('.side-question');
  assert.equal(rows.length, 2, 'drawn as two rows');
  assert.ok(rows[0]?.querySelector('button[aria-label="Dismiss"]'), 'the control sits on the question row, which starts the aside');
});

test('the dismiss control asks the server to delete the side question', async () => {
  renderRows([question('done'), answer('done', 'It skips the cache.')]);

  const [dismiss] = screen.getAllByRole('button', { name: 'Dismiss' });
  assert.ok(dismiss, 'a side question can be dismissed');
  fireEvent.click(dismiss);

  await waitFor(() => {
    const deletes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE');
    assert.equal(deletes.length, 1, 'one DELETE request');
    assert.match(String(deletes[0]?.[0]), /\/api\/providers\/sessions\/session-7\/side-questions\/sq-1$/);
  });
});
