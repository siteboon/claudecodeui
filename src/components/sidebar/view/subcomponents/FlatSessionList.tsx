import { useTranslation } from 'react-i18next';
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
  onSessionSelect: (session: FlatSession) => void;
  onSessionClose: (session: FlatSession) => void;
  activeProjectName: string;
  showHotkeys?: boolean;
};

export default function FlatSessionList({
  sessions,
  selectedSessionId,
  currentTime,
  onSessionSelect,
  onSessionClose,
  activeProjectName,
  showHotkeys = false,
}: FlatSessionListProps) {
  const { t } = useTranslation('sidebar');

  if (sessions.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
        No sessions in <span className="text-foreground/80">@{activeProjectName}</span>{' '}
        yet.
        <br />
        <span className="font-mono text-[10px]">Type above to create one.</span>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 overflow-y-auto px-2 py-1.5">
      <div className="flex flex-col gap-0.5">
        {sessions.map((session, index) => (
          <FlatSessionItem
            key={session.id}
            session={session}
            isSelected={session.id === selectedSessionId}
            index={index}
            timeAgo={formatTimeAgo(getSessionDate(session), currentTime)}
            displayName={getDisplayName(session)}
            onSelect={() => onSessionSelect(session)}
            onClose={() => onSessionClose(session)}
            showHotkey={showHotkeys}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
