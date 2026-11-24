import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';

test('MobileMenuButton uses type="button" and opens the menu without submitting an enclosing form', () => {
  const onMenuClick = vi.fn();
  const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());

  render(
    <form onSubmit={onSubmit}>
      <MobileMenuButton onMenuClick={onMenuClick} />
    </form>,
  );

  const button = screen.getByRole('button', { name: 'Open menu' }) as HTMLButtonElement;
  assert.equal(button.type, 'button');

  fireEvent.click(button);
  assert.equal(onMenuClick.mock.calls.length, 1);
  assert.equal(onSubmit.mock.calls.length, 0);
});
