import { useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../../utils/api';

interface TouchedFile {
  fullPath: string;
  basename: string;
  count: number;
}

interface SessionFilesTouchedChipsProps {
  projectName: string;
  sessionId: string;
}

const CACHE = new Map<string, { ts: number; files: TouchedFile[] }>();
const CACHE_TTL_MS = 60_000;

export default function SessionFilesTouchedChips({ projectName, sessionId }: SessionFilesTouchedChipsProps) {
  const cacheKey = `${projectName}::${sessionId}`;
  const cached = CACHE.get(cacheKey);
  const [files, setFiles] = useState<TouchedFile[]>(() =>
    cached && Date.now() - cached.ts < CACHE_TTL_MS ? cached.files : [],
  );
  const [hasFetched, setHasFetched] = useState<boolean>(() => Boolean(cached && Date.now() - cached.ts < CACHE_TTL_MS));
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (hasFetched) {
      return undefined;
    }
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      void fetchAndSet();
      return undefined;
    }

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.disconnect();
            if (!cancelled) {
              void fetchAndSet();
            }
            break;
          }
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };

    async function fetchAndSet() {
      try {
        const response = await authenticatedFetch(
          `/api/mcp-bootstrap/session-files-touched/${encodeURIComponent(projectName)}/${encodeURIComponent(sessionId)}`,
        );
        if (!response.ok) {
          setHasFetched(true);
          return;
        }
        const payload = await response.json();
        const list: TouchedFile[] = Array.isArray(payload?.files) ? payload.files : [];
        CACHE.set(cacheKey, { ts: Date.now(), files: list });
        setFiles(list);
      } catch {
        // silent: chips are optional signal
      } finally {
        setHasFetched(true);
      }
    }
  }, [cacheKey, hasFetched, projectName, sessionId]);

  if (hasFetched && files.length === 0) {
    return <div ref={containerRef} aria-hidden className="h-0" />;
  }

  return (
    <div
      ref={containerRef}
      className="mb-1 ml-6 flex flex-wrap gap-1 px-1"
      aria-label="Files touched in this session"
    >
      {files.map((file) => (
        <span
          key={file.fullPath}
          className="ds-chip ds-chip-lavender h-5 gap-1 px-2 text-[10px] font-medium"
          title={`${file.fullPath} — ${file.count} tool uses`}
        >
          <span className="max-w-[120px] truncate">{file.basename}</span>
          {file.count > 1 && <span className="opacity-70">×{file.count}</span>}
        </span>
      ))}
    </div>
  );
}
