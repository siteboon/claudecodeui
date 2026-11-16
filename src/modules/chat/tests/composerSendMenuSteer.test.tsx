import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ComposerSendMenu from '@/modules/chat/composer/ComposerSendMenu';

/**
 * The send menu's Steer row: while a turn is written, a provider that can take
 * a message into the running turn gets a row for it right under Queue. It is
 * gated by the capability like the side-question row, and only a turn being
 * written has anything to steer — background-only work does not.
 */

const renderMenu = (
  state: 'responding' | 'background',
  { supportsSteering = true, hasInput = true }: { supportsSteering?: boolean; hasInput?: boolean } = {},
) => {
  const onSelect = vi.fn<(choice: string) => void>();
  render(
    <ComposerSendMenu
      state={state}
      hasInput={hasInput}
      supportsSideQuestions
      supportsSteering={supportsSteering}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
};

const open = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Send options' }));
  return screen.getByRole('menu');
};

const labels = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
  .map((row) => (row.textContent ?? '').replace(/(Queue|Steer|Side question|Stop|Send anyway).*/s, '$1'));

const row = (menu: HTMLElement, label: string) => {
  const found = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    .find((candidate) => (candidate.textContent ?? '').startsWith(label));
  assert.ok(found, `the menu has a "${label}" row`);
  return found;
};

afterEach(() => {
  vi.restoreAllMocks();
});

test('while a turn is written, Steer sits right under Queue and reports its choice', () => {
  const { onSelect } = renderMenu('responding');
  const menu = open();

  assert.deepEqual(labels(menu), ['Queue', 'Steer', 'Side question', 'Stop']);
  assert.match(row(menu, 'Steer').textContent ?? '', /Send into this turn; read at the next tool call/);

  fireEvent.click(row(menu, 'Steer'));
  assert.deepEqual(onSelect.mock.calls, [['steer']]);
});

test('a provider that cannot steer gets no Steer row', () => {
  renderMenu('responding', { supportsSteering: false });

  assert.deepEqual(labels(open()), ['Queue', 'Side question', 'Stop']);
});

test('background-only work has no turn to steer, so the row is left out', () => {
  renderMenu('background');

  assert.deepEqual(labels(open()), ['Queue', 'Side question', 'Send anyway']);
});

test('without input, Steer is disabled like Queue', () => {
  const { onSelect } = renderMenu('responding', { hasInput: false });
  const menu = open();

  const steer = row(menu, 'Steer') as HTMLButtonElement;
  assert.ok(steer.disabled || steer.getAttribute('aria-disabled') === 'true');
  fireEvent.click(steer);
  assert.equal(onSelect.mock.calls.length, 0);
});
