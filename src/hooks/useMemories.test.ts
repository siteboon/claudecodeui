import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMemories } from './useMemories';

const STORAGE_KEY = 'memories';

describe('useMemories', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('returns empty array when no memories stored', () => {
    const { result } = renderHook(() => useMemories());
    expect(result.current.memories).toEqual([]);
  });

  it('adds a memory', () => {
    const { result } = renderHook(() => useMemories());
    act(() => result.current.addMemory('Always use TypeScript'));
    expect(result.current.memories).toHaveLength(1);
    expect(result.current.memories[0].content).toBe('Always use TypeScript');
    expect(result.current.memories[0].enabled).toBe(true);
    expect(result.current.memories[0].id).toBeDefined();
    expect(result.current.memories[0].createdAt).toBeDefined();
  });

  it('persists memories to localStorage', () => {
    const { result } = renderHook(() => useMemories());
    act(() => result.current.addMemory('Test memory'));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('Test memory');
  });

  it('loads memories from localStorage on mount', () => {
    const existing = [{ id: '1', content: 'Existing', createdAt: '2024-01-01', enabled: true }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    const { result } = renderHook(() => useMemories());
    expect(result.current.memories).toEqual(existing);
  });

  it('updates a memory', () => {
    const { result } = renderHook(() => useMemories());
    act(() => result.current.addMemory('Original'));
    const id = result.current.memories[0].id;
    act(() => result.current.updateMemory(id, { content: 'Updated' }));
    expect(result.current.memories[0].content).toBe('Updated');
  });

  it('deletes a memory', () => {
    const { result } = renderHook(() => useMemories());
    act(() => result.current.addMemory('To delete'));
    const id = result.current.memories[0].id;
    act(() => result.current.deleteMemory(id));
    expect(result.current.memories).toHaveLength(0);
  });

  it('toggles a memory enabled state', () => {
    const { result } = renderHook(() => useMemories());
    act(() => result.current.addMemory('Toggle me'));
    const id = result.current.memories[0].id;
    act(() => result.current.toggleMemory(id));
    expect(result.current.memories[0].enabled).toBe(false);
    act(() => result.current.toggleMemory(id));
    expect(result.current.memories[0].enabled).toBe(true);
  });

  it('returns enabled memories text for system prompt', () => {
    const { result } = renderHook(() => useMemories());
    act(() => result.current.addMemory('Enabled one'));
    act(() => result.current.addMemory('Enabled two'));
    const id = result.current.memories[0].id;
    act(() => result.current.toggleMemory(id));
    expect(result.current.enabledMemoriesText).toBe('Enabled two');
  });
});
