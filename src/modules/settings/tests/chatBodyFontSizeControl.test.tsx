import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test } from 'vitest';

import ChatBodyFontSizeControl from '@/modules/settings/ChatBodyFontSizeControl';

const CONTROL_LABEL = 'Chat body text size';

test('offers common sizes from 12px to 20px in the dropdown', () => {
  render(<ChatBodyFontSizeControl value={14} onChange={() => {}} label={CONTROL_LABEL} />);

  fireEvent.click(screen.getByRole('button', { name: CONTROL_LABEL }));

  assert.deepEqual(
    screen.getAllByRole('option').map((option) => option.textContent),
    ['12px', '13px', '14px', '15px', '16px', '17px', '18px', '19px', '20px'],
  );
});

test('accepts manually entered sizes across the wider 1px to 50px range', () => {
  const changes: number[] = [];
  render(
    <ChatBodyFontSizeControl
      value={14}
      onChange={(value) => changes.push(value)}
      label={CONTROL_LABEL}
    />,
  );
  const input = screen.getByRole('combobox', { name: CONTROL_LABEL });

  fireEvent.change(input, { target: { value: '1' } });
  fireEvent.blur(input);
  fireEvent.change(input, { target: { value: '50' } });
  fireEvent.blur(input);

  assert.deepEqual(changes, [1, 50]);
});
