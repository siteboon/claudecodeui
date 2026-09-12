import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Tracks the element's layout width, so the pane can tell when the viewport
 * (or a panel resize) has shrunk the transcript below the room the navigator
 * rail needs beside the message column.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.target.getBoundingClientRect().width);
      }
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
