import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, Check, X } from 'lucide-react';
import {
  PROJECT_PALETTE,
  PROJECT_PALETTE_ORDER,
  type ProjectColorKey,
} from '../../utils/projectColors';

type AnchorRect = {
  top: number;
  right: number;
  left: number;
  bottom: number;
};

type ProjectColorPickerProps = {
  projectName: string;
  displayName: string;
  currentColorKey: ProjectColorKey;
  isArchived: boolean;
  anchorRect: AnchorRect;
  onSelect: (key: ProjectColorKey) => void;
  onToggleArchived: () => void;
  onClose: () => void;
};

export default function ProjectColorPicker({
  projectName,
  displayName,
  currentColorKey,
  isArchived,
  anchorRect,
  onSelect,
  onToggleArchived,
  onClose,
}: ProjectColorPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const handleSelectColor = (key: ProjectColorKey) => {
    onSelect(key);
    onClose();
  };

  const handleArchiveClick = () => {
    onToggleArchived();
    onClose();
  };

  const popover = (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Project menu for ${displayName}`}
      style={{
        top: Math.max(8, anchorRect.top - 6),
        left: anchorRect.right + 8,
      }}
      className="fixed z-[60] w-[200px] rounded-lg border border-border bg-popover p-2.5 shadow-xl"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          @{displayName}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {PROJECT_PALETTE_ORDER.map((key) => {
          const color = PROJECT_PALETTE[key];
          const isActive = key === currentColorKey;
          return (
            <button
              key={key}
              onClick={() => handleSelectColor(key)}
              title={color.label}
              aria-label={color.label}
              aria-pressed={isActive}
              className="relative flex h-7 w-7 items-center justify-center rounded-md transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
              style={{ background: color.hex }}
            >
              {isActive && (
                <Check
                  className="h-3.5 w-3.5"
                  style={{ color: color.fg }}
                  strokeWidth={3}
                />
              )}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => handleSelectColor('default')}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-3 w-3" /> Reset color
      </button>
      <div className="my-2 h-px bg-border" />
      <button
        onClick={handleArchiveClick}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {isArchived ? (
          <>
            <ArchiveRestore className="h-3 w-3" /> Unarchive project
          </>
        ) : (
          <>
            <Archive className="h-3 w-3" /> Archive project
          </>
        )}
      </button>
    </div>
  );

  return createPortal(popover, document.body);
}
