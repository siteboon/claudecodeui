import { memo, useCallback, useEffect, useRef } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { Sidebar } from '@/modules/sidebar';
import {
  SIDEBAR_WIDTH_KEYBOARD_STEP,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useSidebarWidth,
} from '@/shared/hooks/useSidebarWidth';
import type { ProjectWorkspaceShellProps } from '@/shared/types';

/** Rendered by ProjectWorkspaceShell to host the sidebar module, docked on desktop and as a drawer on mobile. */
function ProjectSidebarRegion({
  isMobile,
}: Pick<ProjectWorkspaceShellProps, 'isMobile'>) {
  const { t } = useTranslation('common');
  const { sidebarOpen, setSidebarOpen, sidebarSharedProps } = useProjectSidebarState();
  const { width: sidebarWidth, setWidth: setSidebarWidth, resetWidth: resetSidebarWidth } = useSidebarWidth();
  // Drag origin; null while no resize is in progress.
  const resizeOriginRef = useRef<{ pointerX: number; width: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number>(sidebarWidth);

  const handleBackdropClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleBackdropTouch = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  // Sidebar resizing (desktop only). Pointer capture keeps the drag alive when
  // the cursor leaves the 4px handle, and the width is only written to storage
  // once the pointer is released.
  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeOriginRef.current = { pointerX: event.clientX, width: sidebarWidth };
    pendingWidthRef.current = sidebarWidth;
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  const handleResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = resizeOriginRef.current;
    if (!origin) return;

    pendingWidthRef.current = origin.width + (event.clientX - origin.pointerX);
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      setSidebarWidth(pendingWidthRef.current, false);
    });
  }, [setSidebarWidth]);

  const handleResizeEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeOriginRef.current) return;
    resizeOriginRef.current = null;

    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.userSelect = '';
    setSidebarWidth(pendingWidthRef.current);
  }, [setSidebarWidth]);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSidebarWidth(sidebarWidth - SIDEBAR_WIDTH_KEYBOARD_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setSidebarWidth(sidebarWidth + SIDEBAR_WIDTH_KEYBOARD_STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      resetSidebarWidth();
    }
  }, [resetSidebarWidth, setSidebarWidth, sidebarWidth]);

  // A drag interrupted by an unmount must not leave the page unselectable.
  useEffect(() => () => {
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
    document.body.style.userSelect = '';
  }, []);

  if (!isMobile) {
    return (
      <div className="relative h-full flex-shrink-0 border-r border-border/50" style={{ width: sidebarWidth }}>
        <Sidebar {...sidebarSharedProps} />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('versionUpdate.ariaLabels.resizeSidebar')}
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuemax={SIDEBAR_WIDTH_MAX}
          tabIndex={0}
          className="absolute inset-y-0 -right-0.5 z-10 w-1 cursor-col-resize hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onDoubleClick={resetSidebarWidth}
          onKeyDown={handleResizeKeyDown}
        />
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${
        sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
      }`}
    >
      <button
        className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
        onClick={handleBackdropClick}
        onTouchStart={handleBackdropTouch}
        aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
      />
      <div
        className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <Sidebar {...sidebarSharedProps} />
      </div>
    </div>
  );
}

export default memo(ProjectSidebarRegion);
