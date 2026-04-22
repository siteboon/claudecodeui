import {
  Plus,
  Archive,
  RefreshCw,
  Settings,
  Keyboard,
  Folder,
  MessageSquare,
  X,
} from 'lucide-react';

import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  Dialog,
  DialogContent,
  DialogTitle,
} from '../../../../shared/view/ui';
import type { FlatSession } from '../../../../hooks/useFlatSessionList';
import type { ProjectRailItemData } from '../../../project-rail/types/types';

import { KbdCombo } from './Kbd';
import { MOD_KEY, ALT_KEY } from './shortcuts';

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: FlatSession[];
  railItems: ProjectRailItemData[];
  activeProjectName: string;
  hasSelectedSession: boolean;
  hasActiveFilter: boolean;
  onSelectSession: (session: FlatSession) => void;
  onSelectProject: (projectName: string) => void;
  onNewSession: () => void;
  onArchiveActiveSession: () => void;
  onClearProjectFilter: () => void;
  onRefresh: () => void;
  onShowSettings: () => void;
  onShowShortcuts: () => void;
};

export default function CommandPalette({
  open,
  onOpenChange,
  sessions,
  railItems,
  activeProjectName,
  hasSelectedSession,
  hasActiveFilter,
  onSelectSession,
  onSelectProject,
  onNewSession,
  onArchiveActiveSession,
  onClearProjectFilter,
  onRefresh,
  onShowSettings,
  onShowShortcuts,
}: CommandPaletteProps) {
  const run = (fn: () => void) => () => {
    fn();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogTitle>Command Palette</DialogTitle>
        <Command>
          <CommandInput placeholder="Type a command or search sessions…" autoFocus />
          <CommandList className="max-h-[440px]">
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup heading="Actions">
              <CommandItem
                value={`new session ${activeProjectName}`}
                onSelect={run(onNewSession)}
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                <span>
                  New session in{' '}
                  <span style={{ color: 'var(--project-accent)' }}>@{activeProjectName}</span>
                </span>
                <div className="ml-auto">
                  <KbdCombo keys={[MOD_KEY, 'N']} />
                </div>
              </CommandItem>

              {hasSelectedSession && (
                <CommandItem
                  value="archive current session"
                  onSelect={run(onArchiveActiveSession)}
                >
                  <Archive className="h-4 w-4 text-muted-foreground" />
                  <span>Archive current session</span>
                  <div className="ml-auto">
                    <KbdCombo keys={[MOD_KEY, 'W']} />
                  </div>
                </CommandItem>
              )}

              {hasActiveFilter && (
                <CommandItem
                  value="clear project filter"
                  onSelect={run(onClearProjectFilter)}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                  <span>Clear project filter</span>
                  <div className="ml-auto">
                    <KbdCombo keys={['Ctrl', '`']} />
                  </div>
                </CommandItem>
              )}

              <CommandItem value="refresh projects" onSelect={run(onRefresh)}>
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <span>Refresh projects</span>
              </CommandItem>

              <CommandItem value="open settings" onSelect={run(onShowSettings)}>
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span>Open settings</span>
              </CommandItem>

              <CommandItem
                value="keyboard shortcuts help"
                onSelect={run(onShowShortcuts)}
              >
                <Keyboard className="h-4 w-4 text-muted-foreground" />
                <span>Keyboard shortcuts</span>
              </CommandItem>
            </CommandGroup>

            {railItems.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Projects">
                  {railItems.map((project, index) => (
                    <CommandItem
                      key={project.name}
                      value={`project ${project.displayName || project.name}`}
                      onSelect={run(() => onSelectProject(project.name))}
                    >
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{project.displayName || project.name}</span>
                      {index < 6 && (
                        <div className="ml-auto">
                          <KbdCombo keys={['Ctrl', String(index + 1)]} />
                        </div>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {sessions.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Sessions">
                  {sessions.map((session, index) => {
                    const title = session.summary || session.id;
                    return (
                      <CommandItem
                        key={session.id}
                        value={`session ${title} ${session.__projectDisplayName}`}
                        onSelect={run(() => onSelectSession(session))}
                      >
                        <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{title}</span>
                        <span className="flex-shrink-0 truncate text-[11px] text-muted-foreground">
                          @{session.__projectDisplayName}
                        </span>
                        {index < 9 && (
                          <div className="flex-shrink-0">
                            <KbdCombo keys={[ALT_KEY, String(index + 1)]} />
                          </div>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
