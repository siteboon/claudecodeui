import type { MouseEvent } from 'react';

import type { SessionWithProvider } from '../../types/types';

import ConversationItem from './ConversationItem';

interface ConversationGroupProps {
  label: string;
  sessions: SessionWithProvider[];
  selectedSessionId: string | null;
  onSessionClick: (session: SessionWithProvider) => void;
  onMenuOpen: (e: MouseEvent, session: SessionWithProvider) => void;
}

export default function ConversationGroup({
  label,
  sessions,
  selectedSessionId,
  onSessionClick,
  onMenuOpen,
}: ConversationGroupProps) {
  return (
    <div>
      <div
        data-testid="conversation-group-label"
        className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </div>
      {sessions.map((session) => (
        <ConversationItem
          key={session.id}
          session={session}
          isActive={session.id === selectedSessionId}
          onClick={() => onSessionClick(session)}
          onMenuOpen={(e) => onMenuOpen(e, session)}
        />
      ))}
    </div>
  );
}
