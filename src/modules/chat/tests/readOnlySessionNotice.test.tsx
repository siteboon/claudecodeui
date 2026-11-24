import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { test } from 'vitest';

import '@/modules/i18n';
import ReadOnlySessionNotice from '@/modules/chat/composer/ReadOnlySessionNotice';

/**
 * A read-only session (a Cursor IDE chat) shows this notice instead of the
 * composer. Its one action starts a new chat; while that request runs the
 * button can't be pressed again, and a failure is announced so it isn't
 * mistaken for the chat simply not opening.
 */

// Element checks compare booleans: a failing `assert.equal(element, null)` makes
// node:assert print the jsdom element, whose object graph exhausts memory.

test('the button starts one new chat at a time', async () => {
  let finish: () => void = () => {};
  let calls = 0;
  render(
    <ReadOnlySessionNotice
      onContinue={() => {
        calls += 1;
        return new Promise<void>((resolve) => { finish = resolve; });
      }}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Continue in CLI' }));
  const pendingButton = screen.getByRole('button', { name: 'Starting…' }) as HTMLButtonElement;
  assert.equal(pendingButton.disabled, true);
  fireEvent.click(pendingButton);
  assert.equal(calls, 1);

  await act(async () => {
    finish();
  });
  assert.equal((screen.getByRole('button', { name: 'Continue in CLI' }) as HTMLButtonElement).disabled, false);
});

test('a failed start is announced and can be retried', async () => {
  let calls = 0;
  render(
    <ReadOnlySessionNotice
      onContinue={async () => {
        calls += 1;
        throw new Error('HTTP 409');
      }}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue in CLI' }));
  });
  assert.equal(screen.getByRole('alert').textContent, "Couldn't start the new chat. Try again.");

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue in CLI' }));
  });
  assert.equal(calls, 2);
});
