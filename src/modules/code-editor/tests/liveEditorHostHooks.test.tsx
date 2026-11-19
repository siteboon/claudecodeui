import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test, vi } from 'vitest';

/**
 * What the Live editor hands @openmarkdown-dev/editor beyond the document: an
 * accessible name for its textbox, and the app's clipboard helper for the
 * code-block copy button, which also works where `navigator.clipboard` is
 * missing (plain-http origins).
 */

const copyTextToClipboard = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/shared/utils', () => ({ copyTextToClipboard }));

type EditorOptions = { ariaLabel?: string; environment?: { copyText?: (text: string) => unknown } };
const created = vi.hoisted(() => ({ options: null as EditorOptions | null }));

vi.mock('@openmarkdown-dev/editor', () => ({
  openMarkdownText: (source: string) => ({ text: source, source }),
  saveMarkdownText: (doc: string) => doc,
  createEditorState: (options: EditorOptions) => {
    created.options = options;
    return options;
  },
  mountEditor: () => ({
    view: { dom: document.createElement('div') },
    getDoc: () => '',
    setDoc: () => undefined,
    setEnvironment: () => undefined,
    destroy: () => undefined,
  }),
}));

const { default: LiveMarkdownEditor } = await import('@/modules/code-editor/markdown/LiveMarkdownEditor');

test('the Live textbox is named, and code-block copy goes through the app clipboard helper', async () => {
  render(
    <LiveMarkdownEditor
      content={'```js\nlet a = 1;\n```\n'}
      onChange={() => undefined}
      isDarkMode={false}
      fontSize={14}
      ariaLabel="Live editor: notes.md"
    />,
  );

  assert.equal(created.options?.ariaLabel, 'Live editor: notes.md');
  await created.options?.environment?.copyText?.('let a = 1;');
  assert.deepEqual(copyTextToClipboard.mock.calls, [['let a = 1;']]);
});
