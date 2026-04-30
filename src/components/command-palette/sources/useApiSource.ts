import { useEffect, useState } from 'react';

export type ApiSourceState<T> = {
  items: T[];
  isLoading: boolean;
  error: Error | null;
};

export function useApiSource<T, R = unknown>(opts: {
  enabled: boolean;
  deps: React.DependencyList;
  fetcher: (signal: AbortSignal) => Promise<Response>;
  parse: (raw: R) => T[];
}): ApiSourceState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { enabled, deps, fetcher, parse } = opts;

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetcher(controller.signal)
      .then((r) => r.json() as Promise<R>)
      .then((data) => {
        if (controller.signal.aborted) return;
        setItems(parse(data));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setItems([]);
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { items, isLoading, error };
}
