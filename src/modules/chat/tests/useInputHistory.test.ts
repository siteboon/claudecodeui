import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, it } from 'vitest';
import type { KeyboardEvent, RefObject } from 'react';

import { readInputHistory, useInputHistory } from '@/modules/chat/hooks/useInputHistory';

const keyEvent = (
  key: string,
  value: string,
  modifiers: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {},
) => {
  let defaultPrevented = false;
  return {
    event: {
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...modifiers,
      currentTarget: { value },
      preventDefault: () => {
        defaultPrevented = true;
      },
    } as unknown as KeyboardEvent<HTMLTextAreaElement>,
    wasPrevented: () => defaultPrevented,
  };
};

const setUp = (scope: string | null = 'session-1') => {
  const setCalls: string[] = [];
  const textareaRef = { current: null } as RefObject<HTMLTextAreaElement>;
  const { result, rerender } = renderHook(
    ({ currentScope }: { currentScope: string | null }) =>
      useInputHistory({
        setInput: (value: string) => setCalls.push(value),
        textareaRef,
        scope: currentScope,
      }),
    { initialProps: { currentScope: scope } },
  );
  return { result, rerender, setCalls };
};

beforeEach(() => {
  localStorage.clear();
});

describe('useInputHistory', () => {
  it('records sent messages and recalls them newest-first on ArrowUp', () => {
    const { result, setCalls } = setUp();

    act(() => {
      result.current.recordSentMessage('first message');
      result.current.recordSentMessage('second message');
    });
    assert.deepEqual(readInputHistory('session-1'), ['first message', 'second message']);

    const up1 = keyEvent('ArrowUp', '');
    let handled = false;
    act(() => {
      handled = result.current.handleHistoryKeyDown(up1.event);
    });
    assert.equal(handled, true);
    assert.equal(up1.wasPrevented(), true);
    assert.deepEqual(setCalls, ['second message']);

    const up2 = keyEvent('ArrowUp', 'second message');
    act(() => {
      result.current.handleHistoryKeyDown(up2.event);
    });
    assert.deepEqual(setCalls, ['second message', 'first message']);

    // At the oldest entry the event is still consumed, but nothing changes.
    const up3 = keyEvent('ArrowUp', 'first message');
    act(() => {
      handled = result.current.handleHistoryKeyDown(up3.event);
    });
    assert.equal(handled, true);
    assert.deepEqual(setCalls, ['second message', 'first message']);
  });

  it('walks forward with ArrowDown and finally restores the draft', () => {
    const { result, setCalls } = setUp();
    act(() => {
      result.current.recordSentMessage('first message');
      result.current.recordSentMessage('second message');
    });

    act(() => {
      result.current.handleHistoryKeyDown(keyEvent('ArrowUp', '').event);
      result.current.handleHistoryKeyDown(keyEvent('ArrowUp', 'second message').event);
      result.current.handleHistoryKeyDown(keyEvent('ArrowDown', 'first message').event);
      result.current.handleHistoryKeyDown(keyEvent('ArrowDown', 'second message').event);
    });
    // ...up, up, down, down: the last step restores the (empty) draft.
    assert.deepEqual(setCalls, ['second message', 'first message', 'second message', '']);
  });

  it('keeps each chat scope separate and follows the active scope', () => {
    const { result, rerender, setCalls } = setUp('session-1');
    act(() => {
      result.current.recordSentMessage('for session one');
      result.current.recordSentMessage('for session two', 'session-2');
    });
    assert.deepEqual(readInputHistory('session-1'), ['for session one']);
    assert.deepEqual(readInputHistory('session-2'), ['for session two']);

    // ArrowUp in session-1 never surfaces session-2's message.
    act(() => {
      result.current.handleHistoryKeyDown(keyEvent('ArrowUp', '').event);
    });
    assert.deepEqual(setCalls, ['for session one']);

    // Switching chats swaps the history the arrows walk.
    rerender({ currentScope: 'session-2' });
    act(() => {
      result.current.handleHistoryKeyDown(keyEvent('ArrowUp', '').event);
    });
    assert.deepEqual(setCalls, ['for session one', 'for session two']);

    // No scope (no project selected): nothing recorded, nothing recalled.
    rerender({ currentScope: null });
    act(() => {
      result.current.recordSentMessage('dropped');
    });
    let handled = true;
    act(() => {
      handled = result.current.handleHistoryKeyDown(keyEvent('ArrowUp', '').event);
    });
    assert.equal(handled, false);
  });

  it('keeps walking the snapshot taken when recall started, even if storage changes', () => {
    const { result, setCalls } = setUp();
    act(() => {
      result.current.recordSentMessage('only message');
      result.current.handleHistoryKeyDown(keyEvent('ArrowUp', '').event);
    });
    assert.deepEqual(setCalls, ['only message']);

    // Another tab appends to this chat's history mid-recall: ArrowDown must
    // still restore the draft, not surface the foreign entry.
    localStorage.setItem(
      'chat-input-history',
      JSON.stringify({ 'session-1': ['only message', 'from another tab'] }),
    );
    act(() => {
      result.current.handleHistoryKeyDown(keyEvent('ArrowDown', 'only message').event);
    });
    assert.deepEqual(setCalls, ['only message', '']);
  });

  it('leaves the arrows alone while the user is editing text', () => {
    const { result, setCalls } = setUp();
    act(() => {
      result.current.recordSentMessage('a message');
    });

    // A non-empty box that is not an untouched recall: normal caret movement.
    const up = keyEvent('ArrowUp', 'draft in progress');
    let handled = true;
    act(() => {
      handled = result.current.handleHistoryKeyDown(up.event);
    });
    assert.equal(handled, false);
    assert.equal(up.wasPrevented(), false);

    // Same once a recalled message has been edited.
    act(() => {
      result.current.handleHistoryKeyDown(keyEvent('ArrowUp', '').event);
    });
    assert.deepEqual(setCalls, ['a message']);
    act(() => {
      handled = result.current.handleHistoryKeyDown(keyEvent('ArrowUp', 'a message, edited').event);
    });
    assert.equal(handled, false);

    // Modified arrows (e.g. Shift+ArrowUp selection) are never intercepted.
    act(() => {
      handled = result.current.handleHistoryKeyDown(keyEvent('ArrowUp', '', { shiftKey: true }).event);
    });
    assert.equal(handled, false);
  });

  it('skips blank and consecutive-duplicate entries and caps entries per scope', () => {
    const { result } = setUp();
    act(() => {
      result.current.recordSentMessage('   ');
      result.current.recordSentMessage('same');
      result.current.recordSentMessage('same');
    });
    assert.deepEqual(readInputHistory('session-1'), ['same']);

    act(() => {
      for (let i = 0; i < 150; i += 1) {
        result.current.recordSentMessage(`message ${i}`);
      }
    });
    const history = readInputHistory('session-1');
    assert.equal(history.length, 100);
    assert.equal(history[history.length - 1], 'message 149');
  });

  it('evicts the oldest-written scopes past the scope cap', () => {
    const { result } = setUp();
    act(() => {
      for (let i = 0; i < 105; i += 1) {
        result.current.recordSentMessage(`message ${i}`, `session-${i}`);
      }
      // A rewrite refreshes a scope's position in the eviction order.
      result.current.recordSentMessage('kept alive', 'session-5');
      result.current.recordSentMessage('one more', 'session-200');
    });

    assert.deepEqual(readInputHistory('session-5'), ['message 5', 'kept alive']);
    assert.deepEqual(readInputHistory('session-200'), ['one more']);
    assert.deepEqual(readInputHistory('session-6'), []);
  });

  it('ignores a corrupt or pre-scoped stored history', () => {
    localStorage.setItem('chat-input-history', '{not json');
    assert.deepEqual(readInputHistory('session-1'), []);

    // The old format was a flat array; scoped recall starts fresh from it.
    localStorage.setItem('chat-input-history', JSON.stringify(['legacy entry']));
    assert.deepEqual(readInputHistory('session-1'), []);

    const { result } = setUp();
    let handled = true;
    act(() => {
      handled = result.current.handleHistoryKeyDown(keyEvent('ArrowUp', '').event);
    });
    assert.equal(handled, false);
  });
});
