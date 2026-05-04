import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageEdit } from './useMessageEdit';

describe('useMessageEdit', () => {
  it('starts with no edit state', () => {
    const { result } = renderHook(() => useMessageEdit());
    expect(result.current.isEditing).toBe(false);
    expect(result.current.editState).toBeNull();
  });

  it('starts editing a message', () => {
    const { result } = renderHook(() => useMessageEdit());
    act(() => result.current.startEdit(2, 'Hello world'));
    expect(result.current.isEditing).toBe(true);
    expect(result.current.editState?.messageIndex).toBe(2);
    expect(result.current.editState?.originalContent).toBe('Hello world');
    expect(result.current.editState?.editedContent).toBe('Hello world');
  });

  it('updates edit content', () => {
    const { result } = renderHook(() => useMessageEdit());
    act(() => result.current.startEdit(0, 'Original'));
    act(() => result.current.updateEditContent('Modified'));
    expect(result.current.editState?.editedContent).toBe('Modified');
    expect(result.current.editState?.originalContent).toBe('Original');
  });

  it('cancels edit', () => {
    const { result } = renderHook(() => useMessageEdit());
    act(() => result.current.startEdit(0, 'Test'));
    act(() => result.current.cancelEdit());
    expect(result.current.isEditing).toBe(false);
    expect(result.current.editState).toBeNull();
  });

  it('confirms edit and returns state', () => {
    const { result } = renderHook(() => useMessageEdit());
    act(() => result.current.startEdit(1, 'Original'));
    act(() => result.current.updateEditContent('Edited'));
    let confirmed: ReturnType<typeof result.current.confirmEdit>;
    act(() => { confirmed = result.current.confirmEdit(); });
    expect(confirmed!).toEqual({
      messageIndex: 1,
      originalContent: 'Original',
      editedContent: 'Edited',
    });
    expect(result.current.isEditing).toBe(false);
  });
});
