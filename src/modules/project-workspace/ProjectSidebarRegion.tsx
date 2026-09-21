import { memo, useCallback } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useSidebarResize } from '@/modules/project-workspace/hooks/useSidebarResize';
import SidebarResizeHandle from '@/modules/project-workspace/SidebarResizeHandle';
import { Sidebar } from '@/modules/sidebar';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { ProjectWorkspaceShellProps } from '@/shared/types';

/** Rendered by ProjectWorkspaceShell to host the sidebar module, docked on desktop and as a drawer on mobile. */
function ProjectSidebarRegion({
  isMobile,
}: Pick<ProjectWorkspaceShellProps, 'isMobile'>) {
  const { t } = useTranslation('common');
  const { sidebarOpen, setSidebarOpen, sidebarSharedProps } = useProjectSidebarState();
  const { sidebarVisible } = useUiPreferences();
  const {
    sidebarWidth,
    isResizing,
    containerRef,
    minWidth,
    maxWidth,
    handleProps,
  } = useSidebarResize();

  const handleBackdropClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleBackdropTouch = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  if (!isMobile) {
    // The collapsed icon rail sizes itself; only the expanded sidebar takes the
    // user-chosen width and the resize handle.
    if (!sidebarVisible) {
      return (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} />
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        style={{ width: sidebarWidth }}
        className="relative h-full flex-shrink-0 border-r border-border/50"
      >
        <Sidebar {...sidebarSharedProps} />
        <SidebarResizeHandle
          width={sidebarWidth}
          minWidth={minWidth}
          maxWidth={maxWidth}
          isResizing={isResizing}
          {...handleProps}
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
