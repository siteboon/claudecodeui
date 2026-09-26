import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';
import type { PendingPermissionRequest } from '@/shared/types';

/**
 * A permission prompt used to offer Deny with no way to say why, and every
 * Deny sent the same canned "User denied tool use" text. Now a bare Deny sends
 * no message (the server stops the turn), and "Deny with reason" opens a small
 * input whose text is sent as the message the model reads.
 */

const REQUEST: PendingPermissionRequest = {
  requestId: 'req-1',
  toolName: 'Bash',
  input: { command: 'rm -rf build' },
  sessionId: 'session-1',
  receivedAt: new Date(),
};

const renderBanner = () => {
  const handlePermissionDecision = vi.fn();
  const view = render(React.createElement(PermissionRequestsBanner, {
    pendingPermissionRequests: [REQUEST],
    handlePermissionDecision,
    handleGrantToolPermission: () => ({ success: true }),
  }));
  return { ...view, handlePermissionDecision };
};

test('a bare Deny sends no message, so the server stops the turn', () => {
  const { getByText, handlePermissionDecision } = renderBanner();

  fireEvent.click(getByText('Deny'));

  assert.deepEqual(handlePermissionDecision.mock.calls, [['req-1', { allow: false }]]);
});

test('a reason typed after "Deny with reason" is sent on Enter', () => {
  const { getByText, getByLabelText, handlePermissionDecision } = renderBanner();

  fireEvent.click(getByText('Deny with reason'));
  const input = getByLabelText('Reason for denying Bash');
  assert.equal(document.activeElement, input, 'the input takes focus so the user can type right away');

  fireEvent.change(input, { target: { value: '  use the staging bucket instead ' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  assert.deepEqual(handlePermissionDecision.mock.calls, [
    ['req-1', { allow: false, message: 'use the staging bucket instead' }],
  ]);
});

test('an empty reason cannot be sent', () => {
  const { getByText, getByLabelText, handlePermissionDecision } = renderBanner();

  fireEvent.click(getByText('Deny with reason'));
  const input = getByLabelText('Reason for denying Bash');
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  assert.equal((getByText('Deny & send') as HTMLButtonElement).disabled, true);
  assert.equal(handlePermissionDecision.mock.calls.length, 0);
});

test('Enter that confirms an IME candidate does not send', () => {
  const { getByText, getByLabelText, handlePermissionDecision } = renderBanner();

  fireEvent.click(getByText('Deny with reason'));
  const input = getByLabelText('Reason for denying Bash');
  fireEvent.change(input, { target: { value: 'ステージング' } });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });

  assert.equal(handlePermissionDecision.mock.calls.length, 0);
});

test('Escape closes the reason input without deciding and without stopping the run', () => {
  const { getByText, getByLabelText, queryByLabelText, handlePermissionDecision } = renderBanner();
  // Stands in for the chat's global Escape, which stops the run from a
  // capture listener on `document` unless the key was already claimed.
  const globalEscape = vi.fn((event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
    }
  });
  document.addEventListener('keydown', globalEscape, { capture: true });

  try {
    fireEvent.click(getByText('Deny with reason'));
    fireEvent.keyDown(getByLabelText('Reason for denying Bash'), { key: 'Escape' });

    assert.equal(queryByLabelText('Reason for denying Bash'), null);
    assert.ok(getByText('Deny'), 'the buttons are back');
    assert.equal(handlePermissionDecision.mock.calls.length, 0);
    assert.equal(globalEscape.mock.calls.length, 0, 'the run-stopping Escape never saw the key');
  } finally {
    document.removeEventListener('keydown', globalEscape, { capture: true });
  }
});

test('every label of the prompt follows the UI language', async () => {
  await i18n.changeLanguage('de');
  try {
    const { container, getByText } = renderBanner();

    assert.ok(getByText('Berechtigung erforderlich'));
    assert.ok(getByText('Werkzeugeingabe anzeigen'));
    const buttons = Array.from(container.querySelectorAll('button')).map((button) => button.textContent);
    assert.deepEqual(buttons, ['Ablehnen', 'Mit Begründung ablehnen', 'Erlauben & merken', 'Einmal erlauben']);
  } finally {
    await i18n.changeLanguage('en');
  }
});
