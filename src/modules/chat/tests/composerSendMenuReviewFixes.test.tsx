import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ComposerSendMenu from '@/modules/chat/composer/ComposerSendMenu';

/**
 * Two review fixes on `ComposerSendMenu`:
 *
 * - The destructive row (Stop / Send anyway) lost `text-destructive-foreground`
 *   and renders `text-destructive` instead, in both states.
 * - A new `hasText` prop, defaulting to `hasInput`, alone gates the side question: an
 *   attachment-only composer (`hasInput` true, `hasText` false) still enables
 *   Queue but disables the side question.
 */

type SendMenuState = 'responding' | 'background';
type SendMenuChoice = 'queue' | 'sideQuestion' | 'stop' | 'send';

const open = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Send options' }));
  return screen.getByRole('menu');
};

const items = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
const labelOf = (item: HTMLElement) => {
  const text = item.textContent ?? '';
  for (const label of ['Queue', 'Side question', 'Stop', 'Send anyway']) {
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
const classesOf = (row: HTMLElement): string[] => (row.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

afterEach(() => {
  vi.restoreAllMocks();
});

for (const [state, destructiveLabel] of [
  ['responding', 'Stop'],
  ['background', 'Send anyway'],
] as const) {
  test(`the destructive row while ${state} uses text-destructive, not text-destructive-foreground`, () => {
    render(<ComposerSendMenu state={state as SendMenuState} hasInput onSelect={vi.fn<(choice: SendMenuChoice) => void>()} />);
    const menu = open();
    const row = item(menu, destructiveLabel);

    const classes = classesOf(row);
    assert.ok(classes.includes('text-destructive'), `${destructiveLabel} has text-destructive`);
    assert.ok(!classes.includes('text-destructive-foreground'), `${destructiveLabel} does not have text-destructive-foreground`);
  });
}

test('hasText false with hasInput true disables Side question but leaves Queue enabled', () => {
  const onSelect = vi.fn<(choice: SendMenuChoice) => void>();
  render(<ComposerSendMenu state="responding" hasInput hasText={false} supportsSideQuestions onSelect={onSelect} />);
  const menu = open();

  assert.ok(isDisabled(item(menu, 'Side question')), 'Side question is disabled without text');
  assert.ok(!isDisabled(item(menu, 'Queue')), 'Queue stays enabled on an attachment alone');

  fireEvent.click(item(menu, 'Side question'));
  assert.equal(onSelect.mock.calls.length, 0, 'a disabled Side question does nothing');

  fireEvent.click(item(menu, 'Queue'));
  assert.equal(onSelect.mock.calls.length, 1);
});
