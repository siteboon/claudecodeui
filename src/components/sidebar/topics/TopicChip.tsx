import React from 'react';

import { cn } from '../../../lib/utils';

import type { TopicColor } from './useServerTopics';

export interface TopicChipProps {
  label: string;
  color?: TopicColor | null;
  isActive: boolean;
  isDropTarget?: boolean;
  /** Server-provided count of sessions for this topic. Hidden when 0. */
  count?: number;
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
  count,
  onClick,
  onContextMenu,
  children,
  dropRef,
  dragAttributes,
  dataTopicId,
}: TopicChipProps): JSX.Element {
  const showCount = typeof count === 'number' && count > 0;
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
        'min-h-[44px] whitespace-nowrap px-3 flex items-center gap-1.5',
      )}
      style={
        isDropTarget
          ? ({
              '--tw-ring-color': 'var(--midnight-accent)',
              '--tw-ring-offset-color': 'var(--midnight-bg)',
            } as React.CSSProperties)
          : undefined
      }
      {...dragAttributes}
    >
      {children}
      <span className="text-xs font-semibold">{label}</span>
      {showCount && (
        <span
          className={cn(
            'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none',
            isActive
              ? 'bg-background/20 text-current'
              : 'bg-foreground/10 text-muted-foreground',
          )}
          aria-hidden="true"
        >
          {count}
        </span>
      )}
    </button>
  );
}
