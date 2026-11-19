import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { test, vi } from 'vitest';

import type { MarkdownViewMode } from '@/shared/types';

/**
 * The Live editor is a lazy chunk. When that chunk fails to load (a network
 * error, or a chunk a redeploy removed), React caches the rejected import and
 * rethrows it on render. That must not take the editor down: the file goes
 * back to the Code view with its buffer. Picking Live again retries a load
 * that failed transiently. A chunk that a redeploy removed fails again on
 * retry, so that case needs a page reload.
 */

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => <div data-testid="code-editor">{value}</div>,
}));

const chunk = vi.hoisted(() => ({ loads: 0, failNext: true }));

vi.mock('@/modules/code-editor/markdown/LiveMarkdownEditor', async () => {
  chunk.loads += 1;
  if (chunk.failNext) {
    chunk.failNext = false;
    throw new Error('Failed to fetch dynamically imported module');
  }
  return {
    default: ({ ariaLabel }: { ariaLabel?: string }) => <div data-testid="live-editor" aria-label={ariaLabel} />,
  };
});

const { default: CodeEditorSurface } = await import('@/modules/code-editor/CodeEditorSurface');

// The owner's side of the contract: CodeEditor keeps the mode and the buffer,
// and switches back to Code when the surface reports Live is unavailable.
const liveEditorErrors = vi.fn();
function EditorStandIn() {
  const [markdownMode, setMarkdownMode] = useState<MarkdownViewMode>('code');
  return (
    <>
      <button type="button" onClick={() => setMarkdownMode('live')}>Live</button>
      <CodeEditorSurface
        content="# Unsaved edit"
        onChange={() => undefined}
        markdownMode={markdownMode}
        isMarkdownFile
        isDarkMode={false}
        fontSize={14}
        showLineNumbers
        extensions={[]}
        liveEditorLabel="Live editor: notes.md"
        onLiveEditorError={() => {
          liveEditorErrors();
          setMarkdownMode('code');
        }}
      />
    </>
  );
}

test('a Live chunk that fails to load falls back to Code, and Live can be retried', async () => {
  // React logs the caught error; it is the expected outcome here.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<EditorStandIn />);

  fireEvent.click(screen.getByRole('button', { name: 'Live' }));
  await waitFor(() => assert.equal(liveEditorErrors.mock.calls.length, 1));
  // Back in Code, with the buffer as it was.
  assert.equal(screen.getByTestId('code-editor').textContent, '# Unsaved edit');
  assert.equal(chunk.loads, 1);

  fireEvent.click(screen.getByRole('button', { name: 'Live' }));
  const liveView = await screen.findByTestId('live-editor');
  await waitFor(() => assert.equal(chunk.loads, 2));
  // The retried editor is named after the file it edits.
  assert.equal(liveView.getAttribute('aria-label'), 'Live editor: notes.md');
});
