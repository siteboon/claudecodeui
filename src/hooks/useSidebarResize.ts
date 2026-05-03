import { useCallback, useState } from 'react';

const STORAGE_KEY = 'sidebar-width';
const DEFAULT_WIDTH = 260;
const DEFAULT_MIN = 200;
const DEFAULT_MAX = 400;

type UseSidebarResizeOptions = {
  initialWidth?: number;
  min?: number;
  max?: number;
};

export function useSidebarResize(opts?: UseSidebarResizeOptions) {
  const min = opts?.min ?? DEFAULT_MIN;
  const max = opts?.max ?? DEFAULT_MAX;

  const [width, setWidthRaw] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) return Math.min(max, Math.max(min, parsed));
      }
    } catch { /* localStorage unavailable */ }
    return opts?.initialWidth ?? DEFAULT_WIDTH;
  });

  const setWidth = useCallback(
    (newWidth: number) => {
      setWidthRaw(Math.min(max, Math.max(min, newWidth)));
    },
    [min, max],
  );

  const persist = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch { /* localStorage unavailable */ }
  }, [width]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const onMove = (ev: MouseEvent) => {
        const newWidth = Math.min(max, Math.max(min, startWidth + ev.clientX - startX));
        setWidthRaw(newWidth);
        document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try {
          localStorage.setItem(STORAGE_KEY, String(width));
        } catch { /* localStorage unavailable */ }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [width, min, max],
  );

  return { width, setWidth, persist, handleResizeStart };
}
