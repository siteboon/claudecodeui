import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ComposerSendMenu from '@/modules/chat/composer/ComposerSendMenu';

/**
 * While something runs, the send button stops being a one-tap Stop and opens
 * a menu with the choices that make sense in that state. The destructive one
 * is last and red, as in the background-send dialog, so a tap on the first
 * row can never stop anything.
 *
 * The props are the narrowest guess at the component's interface: which
 * state it is drawn for, whether the composer holds input, and one callback
 * that names the choice — the same shape as the dialog's `onResolve`.
 */

type SendMenuState = 'responding' | 'background';
type SendMenuChoice = 'queue' | 'btw' | 'stop' | 'send';

const renderMenu = (state: SendMenuState, hasInput: boolean) => {
  const onSelect = vi.fn<(choice: SendMenuChoice) => void>();
  const view = render(<ComposerSendMenu state={state} hasInput={hasInput} onSelect={onSelect} />);
  return { ...view, onSelect };
};

const open = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Send options' }));
  return screen.getByRole('menu');
};

// Menu rows may be drawn as `menuitem` or `menuitemradio`; their name leads
// with the label, followed by the description.
const items = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
const labelOf = (item: HTMLElement) => {
  const text = item.textContent ?? '';
  for (const label of ['Queue', 'BTW', 'Stop', 'Send anyway']) {
    if (text.startsWith(label)) return label;
  }
  return text;
};
const item = (menu: HTMLElement, label: string) => {
  const found = items(menu).find((row) => labelOf(row) === label);
  assert.ok(found, `the menu has a "${label}" row`);
  return found;
};
const isDisabled = (row: HTMLElement) =>
  (row as HTMLButtonElement).disabled || row.getAttribute('aria-disabled') === 'true';
const looksDestructive = (row: HTMLElement) =>
  [row, ...Array.from(row.querySelectorAll<HTMLElement>('*'))]
    .some((element) => /destructive|red-/.test(element.getAttribute('class') ?? ''));

// The separator is the menu's only aria-hidden element outside a row (icons
// inside rows are aria-hidden too and do not count).
const separatorsBetween = (menu: HTMLElement, before: HTMLElement, after: HTMLElement) =>
  Array.from(menu.querySelectorAll<HTMLElement>('[aria-hidden="true"], [aria-hidden=""]'))
    .filter((element) => !element.closest('[role^="menuitem"]') && element.tagName.toLowerCase() !== 'svg')
    .filter((element) =>
      Boolean(before.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      && Boolean(after.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING));

afterEach(() => {
  vi.restoreAllMocks();
});

test('the trigger is the send-options button, and the menu is closed until it is pressed', () => {
  renderMenu('responding', true);

  assert.ok(screen.getByRole('button', { name: 'Send options' }));
  assert.ok(screen.queryByRole('menu') === null, 'the menu is closed');
});

test('while a turn is written the menu offers Queue, BTW and then Stop, Stop last and red', () => {
  renderMenu('responding', true);
  const menu = open();

  assert.deepEqual(items(menu).map(labelOf), ['Queue', 'BTW', 'Stop']);
  const stop = item(menu, 'Stop');
  assert.ok(looksDestructive(stop), 'Stop is drawn as the destructive choice');
  assert.ok(!looksDestructive(item(menu, 'Queue')), 'Queue is not');
  assert.ok(!looksDestructive(item(menu, 'BTW')), 'BTW is not');
  assert.equal(separatorsBetween(menu, item(menu, 'BTW'), stop).length, 1, 'a separator sets Stop apart');
  assert.match(item(menu, 'Queue').textContent ?? '', /Send when this turn ends/);
  assert.match(item(menu, 'BTW').textContent ?? '', /Ask on the side now; the session never sees it/);
  assert.match(stop.textContent ?? '', /End the response being written/);
});

test('while only background work runs the menu offers Queue, BTW and then Send anyway, Send anyway last and red', () => {
  renderMenu('background', true);
  const menu = open();

  assert.deepEqual(items(menu).map(labelOf), ['Queue', 'BTW', 'Send anyway']);
  const sendAnyway = item(menu, 'Send anyway');
  assert.ok(looksDestructive(sendAnyway), 'Send anyway is drawn as the destructive choice');
  assert.ok(!looksDestructive(item(menu, 'Queue')));
  assert.ok(!looksDestructive(item(menu, 'BTW')));
  assert.equal(separatorsBetween(menu, item(menu, 'BTW'), sendAnyway).length, 1, 'a separator sets Send anyway apart');
  assert.match(item(menu, 'Queue').textContent ?? '', /Send when the background work ends/);
  assert.match(sendAnyway.textContent ?? '', /Send now; this stops the background work/);
});

test('without input, Queue and BTW are disabled while a turn is written, and Stop stays enabled', () => {
  const { onSelect } = renderMenu('responding', false);
  const menu = open();

  assert.ok(isDisabled(item(menu, 'Queue')));
  assert.ok(isDisabled(item(menu, 'BTW')));
  assert.ok(!isDisabled(item(menu, 'Stop')), 'stopping needs no input');

  fireEvent.click(item(menu, 'Queue'));
  fireEvent.click(item(menu, 'BTW'));
  assert.equal(onSelect.mock.calls.length, 0, 'a disabled row does nothing');

  fireEvent.click(item(menu, 'Stop'));
  assert.deepEqual(onSelect.mock.calls.map((args) => args.map((arg) => (typeof arg === 'string' ? arg : typeof arg))), [['stop']], 'Stop works with an empty composer');
});

test('without input, Queue, BTW and Send anyway are all disabled while background work runs', () => {
  const { onSelect } = renderMenu('background', false);
  const menu = open();

  assert.ok(isDisabled(item(menu, 'Queue')));
  assert.ok(isDisabled(item(menu, 'BTW')));
  assert.ok(isDisabled(item(menu, 'Send anyway')));

  fireEvent.click(item(menu, 'Send anyway'));
  assert.equal(onSelect.mock.calls.length, 0);
});

test('with input, every row is enabled', () => {
  renderMenu('background', true);
  const menu = open();

  for (const row of items(menu)) {
    assert.ok(!isDisabled(row), `${labelOf(row)} is enabled`);
  }
});

const choicesFor: Array<[SendMenuState, string, SendMenuChoice]> = [
  ['responding', 'Queue', 'queue'],
  ['responding', 'BTW', 'btw'],
  ['responding', 'Stop', 'stop'],
  ['background', 'Queue', 'queue'],
  ['background', 'BTW', 'btw'],
  ['background', 'Send anyway', 'send'],
];

for (const [state, label, choice] of choicesFor) {
  test(`${label} while ${state} calls back once with "${choice}"`, () => {
    const { onSelect, unmount } = renderMenu(state, true);
    const menu = open();

    fireEvent.click(item(menu, label));

    // Mapped to strings first: an event passed along must not be deep-printed.
    assert.deepEqual(onSelect.mock.calls.map((args) => args.map((arg) => (typeof arg === 'string' ? arg : typeof arg))), [[choice]]);
    unmount();
  });
}
