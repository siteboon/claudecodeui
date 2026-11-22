import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { expect, test, vi } from 'vitest';

import BrowserControlView from '@/modules/browser-use/BrowserControlView';
import '@/modules/i18n';

const { control } = vi.hoisted(() => ({ control: vi.fn() }));
vi.mock('@/shared/api', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  api: { browserUse: { control } },
}));

test('requests a private live frame, sends text and releases only on explicit hand-back', async () => {
  control.mockImplementation(async (_id, action) => Response.json({
    data: action === 'frame' ? { screenshotDataUrl: 'data:image/jpeg;base64,AA==' } : {},
  }));
  const onClose = vi.fn();
  const onReturned = vi.fn();
  render(<BrowserControlView sessionId="session" controlId="lease" onClose={onClose} onLost={vi.fn()} onReturned={onReturned} />);
  await screen.findByRole('img');
  const keyboard = screen.getByRole('textbox', { name: /focus browser keyboard/i });
  fireEvent.change(keyboard, { target: { value: 'hello' } });
  await waitFor(() => expect(control).toHaveBeenCalledWith('session', 'input', { controlId: 'lease', type: 'text', text: 'hello' }, expect.any(Object)));
  fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(control.mock.calls.some(([, action]) => action === 'release')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /return to agent/i }));
  await waitFor(() => expect(onReturned).toHaveBeenCalledOnce());
  expect(control).toHaveBeenCalledWith('session', 'release', { controlId: 'lease' });
});
