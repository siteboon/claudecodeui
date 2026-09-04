import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import { PromptInput, PromptInputSubmit } from '@/modules/chat/composer/PromptInput';

/**
 * PromptInputSubmit used to accept its own `status` prop and fall back to
 * `context?.status ?? 'ready'`. Nothing ever passed the prop and the button is
 * only ever rendered inside PromptInput, so both the prop and the null-context
 * default were unreachable — and the default silently rendered a send button
 * for a composer that was actually streaming.
 *
 * It now reads the root's status through the context, which is the only place
 * the status is ever set.
 */

const renderSubmit = (status: 'ready' | 'streaming') =>
  render(
    React.createElement(PromptInput, { status },
      React.createElement(PromptInputSubmit, { 'aria-label': 'submit' })),
  );

test('a ready composer submits the form', () => {
  const { getByLabelText } = renderSubmit('ready');
  assert.equal(getByLabelText('submit').getAttribute('type'), 'submit');
});

test('a streaming composer turns the button into a stop control, not a submit', () => {
  // type="button" is what keeps the stop click from re-submitting the form.
  const { getByLabelText } = renderSubmit('streaming');
  assert.equal(getByLabelText('submit').getAttribute('type'), 'button');
});

test('the button cannot be rendered outside PromptInput', () => {
  // React logs the thrown render error; the throw is the assertion here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  assert.throws(
    () => render(React.createElement(PromptInputSubmit, { 'aria-label': 'submit' })),
    /within PromptInput/,
  );
});
