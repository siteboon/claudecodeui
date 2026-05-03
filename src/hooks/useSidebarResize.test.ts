import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useSidebarResize } from './useSidebarResize';

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

describe('useSidebarResize', () => {
  it('returns default width of 260 when no stored value', () => {
    const { result } = renderHook(() => useSidebarResize());
    expect(result.current.width).toBe(260);
  });

  it('reads initial width from localStorage', () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('300');
    const { result } = renderHook(() => useSidebarResize());
    expect(result.current.width).toBe(300);
  });

  it('setWidth updates the width within bounds', () => {
    const { result } = renderHook(() => useSidebarResize());

    act(() => {
      result.current.setWidth(320);
    });
    expect(result.current.width).toBe(320);
  });

  it('clamps width to min bound', () => {
    const { result } = renderHook(() => useSidebarResize({ min: 200 }));

    act(() => {
      result.current.setWidth(150);
    });
    expect(result.current.width).toBe(200);
  });

  it('clamps width to max bound', () => {
    const { result } = renderHook(() => useSidebarResize({ max: 400 }));

    act(() => {
      result.current.setWidth(500);
    });
    expect(result.current.width).toBe(400);
  });

  it('persist saves to localStorage', () => {
    const { result } = renderHook(() => useSidebarResize());

    act(() => {
      result.current.setWidth(280);
    });

    act(() => {
      result.current.persist();
    });

    expect(localStorage.setItem).toHaveBeenCalledWith('sidebar-width', '280');
  });
});
