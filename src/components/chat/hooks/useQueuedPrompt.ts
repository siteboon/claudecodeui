import { useCallback, useEffect, useRef, useState } from 'react';

interface UseQueuedPromptOptions {
  isLoading: boolean;
  onFire: (text: string) => void;
}

interface UseQueuedPromptResult {
  queuedPrompt: string | null;
  enqueue: (text: string) => void;
  clearQueue: () => void;
}

export function useQueuedPrompt({ isLoading, onFire }: UseQueuedPromptOptions): UseQueuedPromptResult {
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const prevLoadingRef = useRef(isLoading);
  const onFireRef = useRef(onFire);

  // Keep latest onFire without re-triggering effect
  useEffect(() => {
    onFireRef.current = onFire;
  }, [onFire]);

  // Detect isLoading false → true transition
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoading;
    if (wasLoading && !isLoading && queuedPrompt) {
      const text = queuedPrompt;
      setQueuedPrompt(null);
      // Fire async to let any final-stream updates settle
      setTimeout(() => onFireRef.current(text), 0);
    }
  }, [isLoading, queuedPrompt]);

  const enqueue = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQueuedPrompt(trimmed);
  }, []);

  const clearQueue = useCallback(() => {
    setQueuedPrompt(null);
  }, []);

  return { queuedPrompt, enqueue, clearQueue };
}
