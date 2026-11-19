import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';

import { useEscapeToAbortSession } from '@/modules/chat/hooks/useEscapeToAbortSession';

/**
 * Regression guard: pressing Escape to cancel a sidebar session rename also
 * stopped the running agent, because the chat's abort-on-Escape listener runs
 * in the document capture phase, ahead of the rename input's own handler.
 * Escape now stops the turn only when nothing else on the page owns it.
 */

function appendElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.body.appendChild(element);
  return element;
}

function renderEscapeToAbort({ canAbortSession = true } = {}) {
  const composer = appendElement('textarea');
  const composerRef: RefObject<HTMLTextAreaElement> = { current: composer };
  const onAbortSession = vi.fn();
  renderHook(() => useEscapeToAbortSession({ canAbortSession, onAbortSession, composerRef }));
  return { composer, onAbortSession };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Escape to stop the running turn', () => {
  it('stops the turn from the composer and from the page itself', () => {
    const { composer, onAbortSession } = renderEscapeToAbort();

    fireEvent.keyDown(composer, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onAbortSession).toHaveBeenCalledTimes(2);
  });

  it('leaves the turn running when Escape cancels a rename input', () => {
    const { onAbortSession } = renderEscapeToAbort();
    // Shaped like the sidebar rename: the input cancels on Escape and stops the
    // key from bubbling, which a capture-phase listener never sees.
    const onCancelRename = vi.fn();
    const renameInput = appendElement('input', { type: 'text' });
    renameInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        onCancelRename();
      }
    });

    fireEvent.keyDown(renameInput, { key: 'Escape' });

    expect(onCancelRename).toHaveBeenCalledTimes(1);
    expect(onAbortSession).not.toHaveBeenCalled();
  });

  it('leaves Escape to other text fields: textareas and editable content', () => {
    const { onAbortSession } = renderEscapeToAbort();
    const otherTextarea = appendElement('textarea');
    const editable = appendElement('div', { contenteditable: 'true' });
    // jsdom does not implement `isContentEditable`; browsers set it here.
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    fireEvent.keyDown(otherTextarea, { key: 'Escape' });
    fireEvent.keyDown(editable, { key: 'Escape' });

    expect(onAbortSession).not.toHaveBeenCalled();
  });

  it('still stops the turn from a focused control that takes no text', () => {
    const { onAbortSession } = renderEscapeToAbort();
    const checkbox = appendElement('input', { type: 'checkbox' });
    const button = appendElement('button');

    fireEvent.keyDown(checkbox, { key: 'Escape' });
    fireEvent.keyDown(button, { key: 'Escape' });

    expect(onAbortSession).toHaveBeenCalledTimes(2);
  });

  it('leaves Escape to an open menu, modal dialog or marked layer', () => {
    const { composer, onAbortSession } = renderEscapeToAbort();
    const layers: Record<string, string>[] = [
      { role: 'menu' },
      { role: 'dialog', 'aria-modal': 'true' },
      { 'data-escape-layer': '' },
    ];

    for (const attributes of layers) {
      const layer = appendElement('div', attributes);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      fireEvent.keyDown(composer, { key: 'Escape' });
      layer.remove();
    }
    expect(onAbortSession).not.toHaveBeenCalled();

    // With every layer closed, the next Escape reaches the turn again.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onAbortSession).toHaveBeenCalledTimes(1);
  });

  it('leaves an Escape an overlay already consumed, and ignores key repeat', () => {
    const { onAbortSession } = renderEscapeToAbort();
    const consumeEscape = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener('keydown', consumeEscape, { capture: true });
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    } finally {
      window.removeEventListener('keydown', consumeEscape, { capture: true });
    }

    fireEvent.keyDown(document.body, { key: 'Escape', repeat: true });

    expect(onAbortSession).not.toHaveBeenCalled();
  });

  it('does nothing while there is no turn to stop', () => {
    const { onAbortSession } = renderEscapeToAbort({ canAbortSession: false });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onAbortSession).not.toHaveBeenCalled();
  });
});
