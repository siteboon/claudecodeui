import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test } from 'vitest';

import { useCodeEditorSettings } from '@/modules/code-editor/hooks/useCodeEditorSettings';
import { writeCodeEditorSettings } from '@/shared/codeEditorSettings';
import { CODE_EDITOR_SETTINGS_CHANGED_EVENT, CODE_EDITOR_STORAGE_KEYS } from '@/shared/constants';

/**
 * The receiving half of the code-editor settings contract. The settings dialog
 * writes the four keys and dispatches CODE_EDITOR_SETTINGS_CHANGED_EVENT,
 * because `storage` does not fire in the tab that performed the write — so
 * without this listener the open editor keeps the old font until a reload.
 *
 * The editor also decodes fontSize as a number while the dialog stores a string;
 * both used to run their own copy of the decoding.
 */

beforeEach(() => {
  localStorage.clear();
});

test('a settings edit in the same tab reaches the open editor', () => {
  const { result } = renderHook(() => useCodeEditorSettings());
  const before = result.current.fontSize;

  act(() => {
    writeCodeEditorSettings({
      wordWrap: true,
      showMinimap: false,
      lineNumbers: false,
      fontSize: '20',
    });
  });

  assert.notEqual(before, 20);
  assert.equal(result.current.fontSize, 20);
  assert.equal(result.current.wordWrap, true);
  assert.equal(result.current.minimapEnabled, false);
  assert.equal(result.current.showLineNumbers, false);
});

test('a settings edit in another tab reaches the editor through the storage event', () => {
  const { result } = renderHook(() => useCodeEditorSettings());

  act(() => {
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.fontSize, '18');
    window.dispatchEvent(new StorageEvent('storage', {
      key: CODE_EDITOR_STORAGE_KEYS.fontSize,
      newValue: '18',
    }));
  });

  assert.equal(result.current.fontSize, 18);
});

test('the editor reads fontSize as a number, not the stored string', () => {
  localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.fontSize, '16');

  const { result } = renderHook(() => useCodeEditorSettings());

  assert.equal(result.current.fontSize, 16);
});

test('an unset minimap keeps the shared default rather than reading as off', () => {
  // `localStorage.getItem(...) !== 'false'` and "default when absent" agree
  // here only because the default is true; the editor used to decode wordWrap
  // with the opposite rule.
  const { result } = renderHook(() => useCodeEditorSettings());

  assert.equal(result.current.minimapEnabled, true);
  assert.equal(result.current.showLineNumbers, true);
  assert.equal(result.current.wordWrap, false);
});

test('the editor stops listening once it unmounts', () => {
  const { result, unmount } = renderHook(() => useCodeEditorSettings());
  unmount();

  act(() => {
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.fontSize, '30');
    window.dispatchEvent(new Event(CODE_EDITOR_SETTINGS_CHANGED_EVENT));
  });

  assert.notEqual(result.current.fontSize, 30);
});
