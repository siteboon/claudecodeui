import { useEffect } from 'react';
import type { RefObject } from 'react';

import { ESCAPE_LAYER_SELECTOR } from '@/shared/constants';

// Input types that hold no text. Escape on one of these (a focused checkbox or
// button) is not cancelling anything, so it still stops the turn.
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether the element is a field the user types into, where Escape has its own meaning. */
function isTextEntryElement(element: HTMLElement): boolean {
  if (element.isContentEditable) {
    return true;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }
  return element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type);
}

/**
 * Whether an Escape belongs to some other part of the page rather than to the
 * running turn: it was typed into a text field other than the composer (an
 * inline rename, the terminal, the code editor), or an open menu or modal
 * dialog is about to close on it.
 */
function isEscapeOwnedElsewhere(event: KeyboardEvent, composer: HTMLTextAreaElement | null): boolean {
  const { target } = event;
  if (target instanceof HTMLElement && target !== composer && isTextEntryElement(target)) {
    return true;
  }
  return document.querySelector(ESCAPE_LAYER_SELECTOR) !== null;
}

type UseEscapeToAbortSessionArgs = {
  /** The listener is only attached while there is a running turn to stop. */
  canAbortSession: boolean;
  onAbortSession: () => void;
  /** The chat composer, the one text field where Escape stops the turn. */
  composerRef: RefObject<HTMLTextAreaElement>;
};

/**
 * Lets Escape stop the running turn from anywhere in the page, except where
 * Escape already means something else.
 *
 * The listener runs in the document's capture phase, ahead of every handler on
 * the focused element, so a rename input calling `stopPropagation` cannot
 * shield its Escape. Ownership is decided here instead, from the focused field
 * and any open layer. Overlays that must win outright still do so from a window
 * capture listener that calls `preventDefault`, which is honoured below.
 */
export function useEscapeToAbortSession({
  canAbortSession,
  onAbortSession,
  composerRef,
}: UseEscapeToAbortSessionArgs) {
  useEffect(() => {
    if (!canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }
      if (isEscapeOwnedElsewhere(event, composerRef.current)) {
        return;
      }

      event.preventDefault();
      onAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, onAbortSession, composerRef]);
}
