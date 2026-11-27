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
  await waitFor(() => expect(onReturned).toHaveBeenCalledWith('lease'));
  expect(control).toHaveBeenCalledWith('session', 'release', { controlId: 'lease' });
});

test('rejects an oversized paste without partial input, keeps remote Tab focused and drains input before releasing', async () => {
  control.mockClear();
  let finishInput: (response: Response) => void = () => {};
  control.mockImplementation(async (_id, action) => {
    if (action === 'input') return new Promise<Response>((resolve) => { finishInput = resolve; });
    return Response.json({ data: { screenshotDataUrl: 'data:image/jpeg;base64,AA==' } });
  });
  const onReturned = vi.fn();
  render(<BrowserControlView sessionId="session" controlId="lease" onClose={vi.fn()} onLost={vi.fn()} onReturned={onReturned} />);
  await screen.findByRole('img');
  const keyboard = screen.getByRole('textbox');
  fireEvent.change(keyboard, { target: { value: 'a'.repeat(33_000) } });
  expect(screen.getByRole('alert').textContent).toMatch(/not sent/);
  expect(control.mock.calls.some(([, action]) => action === 'input')).toBe(false);

  keyboard.focus();
  fireEvent.keyDown(keyboard, { key: 'Tab' });
  expect(document.activeElement).toBe(keyboard);
  await waitFor(() => expect(control).toHaveBeenCalledWith('session', 'input', { controlId: 'lease', type: 'key', key: 'Tab' }, expect.any(Object)));
  fireEvent.click(screen.getByRole('button', { name: /return to agent/i }));
  fireEvent.change(keyboard, { target: { value: 'late input' } });
  expect(control.mock.calls.some(([, action]) => action === 'release')).toBe(false);
  finishInput(Response.json({ success: true }));
  await waitFor(() => expect(onReturned).toHaveBeenCalledWith('lease'));
  expect(control.mock.calls.filter(([, action]) => action === 'input')).toHaveLength(1);
});

async function renderScrollView() {
  control.mockClear();
  render(<BrowserControlView sessionId="session" controlId="lease" onClose={vi.fn()} onLost={vi.fn()} onReturned={vi.fn()} />);
  const image = await screen.findByRole('img');
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 720, 450));
  Object.defineProperties(image, {
    naturalWidth: { value: 1440 },
    naturalHeight: { value: 900 },
    setPointerCapture: { value: vi.fn() },
  });
  return image;
}

test('coalesces wheel events behind a slow request and scales movement to the remote viewport', async () => {
  let finishFirst: (response: Response) => void = () => {};
  let wheelRequests = 0;
  control.mockImplementation(async (_id, action) => {
    if (action === 'input' && wheelRequests++ === 0) return new Promise<Response>((resolve) => { finishFirst = resolve; });
    return Response.json({ data: { screenshotDataUrl: 'data:image/jpeg;base64,AA==' } });
  });
  const image = await renderScrollView();
  const roll = () => fireEvent.wheel(image, { clientX: 360, clientY: 225, deltaY: 25 });
  roll();
  await waitFor(() => expect(wheelRequests).toBe(1));
  for (let i = 0; i < 5; i++) {
    roll();
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  finishFirst(Response.json({ success: true }));
  await waitFor(() => expect(wheelRequests).toBeGreaterThanOrEqual(2));
  const inputs = control.mock.calls.filter(([, action]) => action === 'input').map(([, , data]) => data);
  expect(inputs).toEqual([50, 250].map(dy => ({ controlId: 'lease', type: 'wheel', x: 0.5, y: 0.5, dx: 0, dy })));
});

test('a touch swipe scrolls the remote browser without clicking or focusing the keyboard', async () => {
  control.mockImplementation(async () => Response.json({
    data: { screenshotDataUrl: 'data:image/jpeg;base64,AA==' },
  }));
  const image = await renderScrollView();
  const pointer = (name: string, y: number) => {
    const event = new MouseEvent(name, { bubbles: true, button: 0, clientX: 360, clientY: y });
    Object.assign(event, { pointerType: 'touch', isPrimary: true, pointerId: 1 });
    fireEvent(image, event);
  };
  pointer('pointerdown', 300);
  pointer('pointermove', 297);
  pointer('pointermove', 240);
  pointer('pointerup', 240);
  await waitFor(() => expect(control).toHaveBeenCalledWith('session', 'input',
    { controlId: 'lease', type: 'wheel', x: 0.5, y: 300 / 450, dx: 0, dy: 120 }, expect.any(Object)));
  expect(control.mock.calls.filter(([, action]) => action === 'input')).toHaveLength(1);
  expect(document.activeElement).not.toBe(screen.getByRole('textbox'));
});
