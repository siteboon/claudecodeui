import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceInput } from './useVoiceInput';

describe('useVoiceInput', () => {
  it('reports unsupported when SpeechRecognition is not available', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isSupported).toBe(false);
  });

  it('starts not listening', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isListening).toBe(false);
  });

  it('does nothing when starting if unsupported', () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());
    expect(result.current.isListening).toBe(false);
  });

  describe('with SpeechRecognition mock', () => {
    const mockStart = vi.fn();
    const mockStop = vi.fn();

    beforeEach(() => {
      mockStart.mockClear();
      mockStop.mockClear();
      (window as any).SpeechRecognition = class {
        continuous = false;
        interimResults = false;
        lang = '';
        onresult = null;
        onerror = null;
        onend = null;
        start = mockStart;
        stop = mockStop;
      };
    });

    afterEach(() => {
      delete (window as any).SpeechRecognition;
    });

    it('reports supported when SpeechRecognition exists', () => {
      const { result } = renderHook(() => useVoiceInput());
      expect(result.current.isSupported).toBe(true);
    });

    it('starts listening and calls start()', () => {
      const { result } = renderHook(() => useVoiceInput());
      act(() => result.current.startListening());
      expect(mockStart).toHaveBeenCalled();
      expect(result.current.isListening).toBe(true);
    });

    it('stops listening', () => {
      const { result } = renderHook(() => useVoiceInput());
      act(() => result.current.startListening());
      act(() => result.current.stopListening());
      expect(mockStop).toHaveBeenCalled();
      expect(result.current.isListening).toBe(false);
    });

    it('toggles listening', () => {
      const { result } = renderHook(() => useVoiceInput());
      act(() => result.current.toggleListening());
      expect(result.current.isListening).toBe(true);
      act(() => result.current.toggleListening());
      expect(result.current.isListening).toBe(false);
    });
  });
});
