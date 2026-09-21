import { memo } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

type SidebarResizeHandleProps = {
  width: number;
  minWidth: number;
  maxWidth: number;
  isResizing: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

/** Rendered by ProjectSidebarRegion on the desktop sidebar's right edge to let the user drag/keyboard-resize it. */
function SidebarResizeHandle({
  width,
  minWidth,
  maxWidth,
  isResizing,
  ...handleProps
}: SidebarResizeHandleProps) {
  const { t } = useTranslation('common');

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resizeHandle')}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      title={t('sidebar.resizeHandle')}
      {...handleProps}
      className={`absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize touch-none transition-colors hover:bg-blue-500 focus-visible:bg-blue-500 focus-visible:outline-none dark:hover:bg-blue-600 dark:focus-visible:bg-blue-600 ${
        isResizing ? 'bg-blue-500 dark:bg-blue-600' : 'bg-transparent'
      }`}
    />
  );
}

export default memo(SidebarResizeHandle);
