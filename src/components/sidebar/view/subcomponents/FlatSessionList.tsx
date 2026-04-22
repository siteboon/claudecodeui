import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { ScrollArea } from '../../../../shared/view/ui';
import type { FlatSession } from '../../../../hooks/useFlatSessionList';
import { getSessionDate } from '../../utils/utils';
import FlatSessionItem from './FlatSessionItem';

function formatTimeAgo(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return 'now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

function getDisplayName(session: FlatSession): string {
  return session.summary || session.name || session.title || 'New Session';
}

type FlatSessionListProps = {
  sessions: FlatSession[];
  selectedSessionId: string | null;
  currentTime: Date;
  searchActive: boolean;
  isArchived: (sessionId: string) => boolean;
  onSessionSelect: (session: FlatSession) => void;
  onToggleArchived: (sessionId: string) => void;
  activeProjectName: string;
  onCreateSession: () => void;
  showHotkeys?: boolean;
};

export default function FlatSessionList({
  sessions,
  selectedSessionId,
  currentTime,
  searchActive,
  isArchived,
  onSessionSelect,
  onToggleArchived,
  activeProjectName,
  onCreateSession,
  showHotkeys = false,
}: FlatSessionListProps) {
  const { t } = useTranslation('sidebar');

  // Archived sessions stay out of sight unless search is active or they're selected.
  const visibleSessions = sessions.filter((session) => {
    if (!isArchived(session.id)) return true;
    if (searchActive) return true;
    if (session.id === selectedSessionId) return true;
    return false;
  });

  const archivedCount = sessions.filter((s) => isArchived(s.id)).length;

  if (visibleSessions.length === 0) {
    if (sessions.length > 0 && archivedCount > 0 && !searchActive) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <p className="text-xs text-muted-foreground">
            {archivedCount} archived session{archivedCount === 1 ? '' : 's'} in{' '}
            <span className="text-foreground/80">@{activeProjectName}</span>
          </p>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            Type to search and reveal
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No sessions in{' '}
          <span className="text-foreground/80">@{activeProjectName}</span>
        </p>
        <button
          type="button"
          onClick={onCreateSession}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
          style={{
            background: 'var(--project-accent)',
            color: 'var(--project-accent-foreground)',
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          New session
        </button>
        <span className="font-mono text-[10px] text-muted-foreground/60">⌘N</span>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 overflow-y-auto px-2 py-1.5">
      <div className="flex flex-col gap-0.5">
        {visibleSessions.map((session, index) => (
          <FlatSessionItem
            key={session.id}
            session={session}
            isSelected={session.id === selectedSessionId}
            isArchived={isArchived(session.id)}
            index={index}
            timeAgo={formatTimeAgo(getSessionDate(session), currentTime)}
            displayName={getDisplayName(session)}
            onSelect={() => onSessionSelect(session)}
            onToggleArchived={() => onToggleArchived(session.id)}
            showHotkey={showHotkeys}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
