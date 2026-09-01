import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test } from 'vitest';

import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, DiffLine } from '@/shared/types';

/**
 * MessageComponent used to render <StreamingMarkdown> while a reply was
 * streaming and <Markdown> once it finished. React treats a different element
 * type in the same position as a different component, so every reply threw away
 * its DOM and rebuilt it at the moment it completed — losing a text selection
 * the user had already started making inside it, and any in-block state such as
 * a code block's "Copied" tick.
 *
 * This asserts on the node identity because that is what the browser keys a
 * selection to; asserting on the HTML would pass either way.
 */

const CONTENT = 'First paragraph.\n\nSecond paragraph.\n';

const assistantMessage = (isStreaming: boolean): ChatMessage => ({
  type: 'assistant',
  content: CONTENT,
  timestamp: '2026-08-21T10:00:00.000Z',
  isStreaming,
});

const createDiff = (): DiffLine[] => [];

// MessageSpeakControl reads the voice preference, so the real provider is
// needed rather than a stub.
const renderMessage = (isStreaming: boolean) => (
  <UiPreferencesProvider>
    <MessageComponent
      message={assistantMessage(isStreaming)}
      prevMessage={null}
      createDiff={createDiff}
      provider="claude"
    />
  </UiPreferencesProvider>
);

test('a reply keeps its DOM when it stops streaming', () => {
  const { container, rerender } = render(renderMessage(true));

  const blocksWhileStreaming = [...container.querySelectorAll('[class*="mb-2"]')];
  assert.ok(blocksWhileStreaming.length > 0, 'expected the reply to have rendered blocks');

  rerender(renderMessage(false));

  const blocksAfter = [...container.querySelectorAll('[class*="mb-2"]')];
  assert.deepEqual(
    blocksAfter.map((node) => blocksWhileStreaming.indexOf(node) !== -1),
    blocksAfter.map(() => true),
    'the finished reply must reuse the nodes it was streaming into',
  );
});

test('the finished reply still shows its whole content', () => {
  const { container, rerender } = render(renderMessage(true));
  rerender(renderMessage(false));

  assert.match(container.textContent ?? '', /First paragraph\./);
  assert.match(container.textContent ?? '', /Second paragraph\./);
});
