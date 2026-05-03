import { MoreHorizontal } from 'lucide-react';
import type { MouseEvent } from 'react';

import type { SessionWithProvider } from '../../types/types';

interface ConversationItemProps {
  session: SessionWithProvider;
  isActive: boolean;
  onClick: () => void;
  onMenuOpen: (e: MouseEvent) => void;
}

export default function ConversationItem({
  session,
  isActive,
  onClick,
  onMenuOpen,
}: ConversationItemProps) {
  return (
    <div
      data-testid="conversation-item"
      className={`group flex cursor-pointer items-center gap-1 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[hsl(var(--sidebar-hover))] ${
        isActive ? 'bg-[hsl(var(--sidebar-active))] font-medium' : ''
      }`}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenuOpen(e);
      }}
    >
      <span className="flex-1 truncate">{session.summary || session.id}</span>
      <button
        data-testid="conversation-menu-btn"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 hover:bg-secondary group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onMenuOpen(e);
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}
