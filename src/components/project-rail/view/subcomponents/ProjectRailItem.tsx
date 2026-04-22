import { useRef, type MouseEvent } from 'react';
import { Tooltip } from '../../../../shared/view/ui';
import type { ProjectRailItemData } from '../../types/types';
import {
  getProjectColor,
  softAccent,
  type ProjectColorKey,
} from '../../utils/projectColors';

type ProjectRailItemProps = {
  item: ProjectRailItemData;
  isActive: boolean;
  isArchived: boolean;
  colorKey: ProjectColorKey;
  onClick: () => void;
  onRequestPicker: (rect: DOMRect) => void;
};

export default function ProjectRailItem({
  item,
  isActive,
  isArchived,
  colorKey,
  onClick,
  onRequestPicker,
}: ProjectRailItemProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const color = getProjectColor(colorKey);
  const hasCustomColor = colorKey !== 'default';

  const handleContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) onRequestPicker(rect);
  };

  return (
    <Tooltip
      content={`${item.displayName}${isArchived ? ' · archived' : ''}`}
      position="right"
    >
      <div className={`relative ${isArchived ? 'opacity-55' : ''}`}>
        {isActive && (
          <div
            className="absolute -left-[10px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-sm"
            style={{ background: color.hex }}
          />
        )}
        <button
          ref={buttonRef}
          onClick={onClick}
          onContextMenu={handleContextMenu}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            isActive ? '' : 'hover:bg-accent/50'
          }`}
          style={
            isActive
              ? { background: softAccent(color.hex, 0.16) }
              : hasCustomColor
                ? { background: softAccent(color.hex, 0.08) }
                : undefined
          }
        >
          <span
            className="text-[11px] font-bold leading-none tracking-tight"
            style={
              hasCustomColor
                ? { color: color.hex }
                : { color: 'hsl(var(--foreground))' }
            }
          >
            {item.abbreviation}
          </span>
        </button>
        {item.attentionCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-rail bg-attention px-0.5 text-[9px] font-bold leading-none text-attention-foreground">
            {item.attentionCount}
          </span>
        )}
      </div>
    </Tooltip>
  );
}
