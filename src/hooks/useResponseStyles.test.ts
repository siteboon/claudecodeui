import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResponseStyles } from './useResponseStyles';

describe('useResponseStyles', () => {
  beforeEach(() => {
    localStorage.removeItem('response-style');
  });
  it('defaults to normal style', () => {
    const { result } = renderHook(() => useResponseStyles());
    expect(result.current.style).toBe('normal');
  });

  it('can set style to concise', () => {
    const { result } = renderHook(() => useResponseStyles());
    act(() => result.current.setStyle('concise'));
    expect(result.current.style).toBe('concise');
  });

  it('can set style to detailed', () => {
    const { result } = renderHook(() => useResponseStyles());
    act(() => result.current.setStyle('detailed'));
    expect(result.current.style).toBe('detailed');
  });

  it('returns system prompt suffix for concise', () => {
    const { result } = renderHook(() => useResponseStyles());
    act(() => result.current.setStyle('concise'));
    expect(result.current.systemPromptSuffix).toContain('concise');
  });

  it('returns empty suffix for normal', () => {
    const { result } = renderHook(() => useResponseStyles());
    expect(result.current.systemPromptSuffix).toBe('');
  });

  it('returns available styles', () => {
    const { result } = renderHook(() => useResponseStyles());
    expect(result.current.availableStyles).toEqual(['concise', 'normal', 'detailed']);
  });

  it('persists to localStorage', () => {
    localStorage.setItem('response-style', 'detailed');
    const { result } = renderHook(() => useResponseStyles());
    expect(result.current.style).toBe('detailed');
    localStorage.removeItem('response-style');
  });
});
