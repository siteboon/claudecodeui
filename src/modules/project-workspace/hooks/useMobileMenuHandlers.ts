import { useCallback, useRef } from 'react';
import type { MouseEvent, TouchEvent } from 'react';

type MenuEvent = MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>;

export function useMobileMenuHandlers(onMenuClick: () => void) {
  const suppressNextMenuClickRef = useRef(false);

  const openMobileMenu = useCallback(
    (event?: MenuEvent) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      onMenuClick();
    },
    [onMenuClick],
  );

  const handleMobileMenuTouchEnd = useCallback(
    (event: TouchEvent<HTMLButtonElement>) => {
      suppressNextMenuClickRef.current = true;
      openMobileMenu(event);

      window.setTimeout(() => {
        suppressNextMenuClickRef.current = false;
      }, 350);
    },
    [openMobileMenu],
  );

  const handleMobileMenuClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (suppressNextMenuClickRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      openMobileMenu(event);
    },
    [openMobileMenu],
  );

  return {
    handleMobileMenuClick,
    handleMobileMenuTouchEnd,
  };
}
