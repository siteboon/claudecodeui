import React from 'react';

import { cn } from '../../../lib/utils';

import type { TopicColor } from './useTopicStorage';

export interface TopicChipProps {
  label: string;
  color?: TopicColor | null;
  isActive: boolean;
  isDropTarget?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
  dropRef?: (node: HTMLElement | null) => void;
  dragAttributes?: React.HTMLAttributes<HTMLElement>;
  dataTopicId?: string;
}

export default function TopicChip({
  label,
  color,
  isActive,
  isDropTarget,
  onClick,
  onContextMenu,
  children,
  dropRef,
  dragAttributes,
  dataTopicId,
}: TopicChipProps): JSX.Element {
  return (
    <button
      ref={dropRef}
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-pressed={isActive}
      data-topic-id={dataTopicId}
      className={cn(
        'ds-chip',
        isActive && 'ds-chip-active',
        !isActive && color && `ds-chip-${color}`,
        isDropTarget && 'ring-2 ring-offset-2',
        'min-h-[44px] whitespace-nowrap px-3'
      )}
      style={
        isDropTarget
          ? ({ '--tw-ring-color': 'var(--midnight-accent)', '--tw-ring-offset-color': 'var(--midnight-bg)' } as React.CSSProperties)
          : undefined
      }
      {...dragAttributes}
    >
      {children}
      <span className="text-xs font-semibold">{label}</span>
    </button>
  );
}
