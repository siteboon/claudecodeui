import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { FlatSession } from '../../../../hooks/useFlatSessionList';

type FlatSessionItemProps = {
  session: FlatSession;
  isSelected: boolean;
  isHidden: boolean;
  index: number;
  timeAgo: string;
  displayName: string;
  onSelect: () => void;
  onToggleHidden: () => void;
  showHotkey?: boolean;
};

function StatusDot({ status }: { status: FlatSession['__status'] }) {
  const colorClass = {
    running: 'bg-status-running',
    waiting: 'bg-status-waiting',
    error: 'bg-status-error',
    idle: 'bg-status-idle',
    done: 'bg-status-done',
  }[status];

  const shouldPulse = status === 'running' || status === 'waiting';

  return (
    <span className="relative inline-flex h-[7px] w-[7px] flex-shrink-0">
      <span className={`h-[7px] w-[7px] rounded-full ${colorClass}`} />
      {shouldPulse && (
        <span
          className={`absolute inset-0 animate-status-pulse rounded-full ${colorClass}`}
        />
      )}
    </span>
  );
}

export default function FlatSessionItem({
  session,
  isSelected,
  isHidden,
  index,
  timeAgo,
  displayName,
  onSelect,
  onToggleHidden,
  showHotkey = false,
}: FlatSessionItemProps) {
  const [hover, setHover] = useState(false);
  const isAttention = session.__status === 'waiting' || session.__status === 'error';

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
        isSelected ? 'bg-accent pl-2' : hover ? 'bg-accent/50' : ''
      } ${isSelected ? 'border-l-2' : 'border-l-2 border-l-transparent'} ${
        isHidden ? 'opacity-55' : ''
      }`}
      style={
        isSelected
          ? { borderLeftColor: 'var(--project-accent)' }
          : undefined
      }
    >
      <StatusDot status={session.__status} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate font-mono text-[10px] leading-tight text-muted-foreground/70">
          <span className="truncate">
            @{session.__projectDisplayName} · {timeAgo}
          </span>
          {isHidden && (
            <span
              className="flex h-3 items-center gap-0.5 rounded-sm bg-muted px-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
              title="Hidden from list"
            >
              <EyeOff className="h-2.5 w-2.5" />
              hidden
            </span>
          )}
        </div>
        <div
          className={`truncate text-[13px] leading-tight ${
            isAttention || isSelected
              ? 'font-medium text-foreground'
              : 'text-muted-foreground'
          }`}
        >
          {displayName}
        </div>
      </div>

      {hover && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleHidden();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              e.preventDefault();
              onToggleHidden();
            }
          }}
          className="flex flex-shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          title={isHidden ? 'Unhide' : 'Hide (findable via search)'}
        >
          {isHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </span>
      )}

      {showHotkey && !hover && index < 8 && (
        <span className="flex-shrink-0 font-mono text-[9px] text-muted-foreground/50">
          ⌘{index + 1}
        </span>
      )}
    </button>
  );
}
