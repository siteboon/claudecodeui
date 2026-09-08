import { useEffect, useState, type DependencyList } from 'react';

export function useApiSource<T, R = unknown>(opts: {
  enabled: boolean;
  deps: DependencyList;
  fetcher: (signal: AbortSignal) => Promise<Response>;
  parse: (raw: R) => T[];
}): T[] {
  const [items, setItems] = useState<T[]>([]);
  const { enabled, deps, fetcher, parse } = opts;

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }

    const controller = new AbortController();

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
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return items;
}
