import { Menu, Settings, PenSquare, ChevronDown } from 'lucide-react';

interface HeaderBarProps {
  isMobile: boolean;
  onMenuClick: () => void;
  onNewChat: () => void;
  onShowSettings: () => void;
  modelName: string;
  onModelSelectorOpen: () => void;
}

export default function HeaderBar({
  onMenuClick,
  onNewChat,
  onShowSettings,
  modelName,
  onModelSelectorOpen,
}: HeaderBarProps) {
  return (
    <header
      data-testid="header-bar"
      className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-border/30 bg-background/80 px-4 backdrop-blur-sm"
    >
      <button
        data-testid="header-menu-btn"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
        onClick={onMenuClick}
      >
        <Menu size={18} />
      </button>

      <button
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-secondary"
        onClick={onModelSelectorOpen}
      >
        <span>{modelName}</span>
        <ChevronDown size={14} className="text-muted-foreground" />
      </button>

      <div className="flex items-center gap-1">
        <button
          data-testid="header-settings-btn"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={onShowSettings}
        >
          <Settings size={18} />
        </button>
        <button
          data-testid="header-new-chat-btn"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={onNewChat}
        >
          <PenSquare size={18} />
        </button>
      </div>
    </header>
  );
}
