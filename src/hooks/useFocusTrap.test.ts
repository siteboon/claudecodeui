import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useFocusTrap } from './useFocusTrap';

describe('useFocusTrap', () => {
  it('returns a ref', () => {
    const { result } = renderHook(() => useFocusTrap(true));
    expect(result.current).toBeDefined();
    expect(result.current.current).toBeNull();
  });

  it('does not throw when disabled', () => {
    expect(() => {
      renderHook(() => useFocusTrap(false));
    }).not.toThrow();
  });
});
