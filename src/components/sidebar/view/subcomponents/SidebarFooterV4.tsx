import { Settings } from 'lucide-react';
import { Tooltip } from '../../../../shared/view/ui';

type SidebarFooterV4Props = {
  userName: string;
  sessionCount: number;
  maxSessions?: number;
  onShowSettings: () => void;
};

export default function SidebarFooterV4({
  userName,
  sessionCount,
  maxSessions,
  onShowSettings,
}: SidebarFooterV4Props) {
  const initial = userName.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-eucalyptus/15 text-[11px] font-semibold text-eucalyptus">
        {initial}
      </div>
      <span className="flex-1 truncate text-xs font-medium text-muted-foreground">
        {userName}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground/60">
        {sessionCount}
        {maxSessions ? `/${maxSessions}` : ''}
      </span>
      <Tooltip content="Settings" position="top">
        <button
          onClick={onShowSettings}
          className="flex rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}
