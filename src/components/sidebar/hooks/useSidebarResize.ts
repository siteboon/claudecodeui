import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

const STORAGE_KEY = 'sidebar-width';
const MIN_WIDTH = 288; // w-72 = 18rem = 288px
const DEFAULT_WIDTH = 288;
const MAX_WIDTH_RATIO = 0.4; // Max 40% of viewport

export const useSidebarResize = () => {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_WIDTH;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Math.max(MIN_WIDTH, parseInt(stored, 10)) : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);

  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    setIsResizing(true);
    event.preventDefault();
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!isResizing) {
        return;
      }

      const newWidth = event.clientX;
      const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;

      if (newWidth >= MIN_WIDTH && newWidth <= maxWidth) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isResizing) {
        localStorage.setItem(STORAGE_KEY, sidebarWidth.toString());
      }
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, sidebarWidth]);

  return {
    sidebarWidth,
    isResizing,
    resizeHandleRef,
    handleResizeStart,
  };
};
