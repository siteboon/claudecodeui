import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, Check, ImagePlus, ImageOff, X } from 'lucide-react';
import { api } from '../../../../utils/api';
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
  hasIcon: boolean;
  anchorRect: AnchorRect;
  onSelect: (key: ProjectColorKey) => void;
  onToggleArchived: () => void;
  onIconChanged: () => void;
  onClose: () => void;
};

export default function ProjectColorPicker({
  projectName,
  displayName,
  currentColorKey,
  isArchived,
  hasIcon,
  anchorRect,
  onSelect,
  onToggleArchived,
  onIconChanged,
  onClose,
}: ProjectColorPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);

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

  const handleUploadClick = () => {
    setIconError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIconBusy(true);
    setIconError(null);
    try {
      const response = await api.uploadProjectIcon(projectName, file);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(body.error || 'Upload failed');
      }
      onIconChanged();
      onClose();
    } catch (err) {
      setIconError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIconBusy(false);
    }
  };

  const handleRemoveIcon = async () => {
    setIconBusy(true);
    setIconError(null);
    try {
      const response = await api.deleteProjectIcon(projectName);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Remove failed' }));
        throw new Error(body.error || 'Remove failed');
      }
      onIconChanged();
      onClose();
    } catch (err) {
      setIconError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setIconBusy(false);
    }
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
      <div className="flex flex-col gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={handleUploadClick}
          disabled={iconBusy}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <ImagePlus className="h-3 w-3" /> {hasIcon ? 'Change icon' : 'Upload icon'}
        </button>
        {hasIcon && (
          <button
            onClick={handleRemoveIcon}
            disabled={iconBusy}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <ImageOff className="h-3 w-3" /> Remove icon
          </button>
        )}
        {iconError && (
          <p className="px-1 text-[10px] leading-tight text-destructive">{iconError}</p>
        )}
      </div>
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
