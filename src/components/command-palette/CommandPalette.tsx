import * as React from 'react';
import { MessageSquarePlus, Settings, SunMoon } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
} from '../../shared/view/ui';
import { useTheme } from '../../contexts/ThemeContext';
import type { Project } from '../../types/app';

type CommandPaletteProps = {
  selectedProject: Project | null;
  onStartNewChat: (project: Project) => void;
  onOpenSettings: () => void;
};

export default function CommandPalette({
  selectedProject,
  onStartNewChat,
  onOpenSettings,
}: CommandPaletteProps) {
  const [open, setOpen] = React.useState(false);
  const { toggleDarkMode } = useTheme();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k';
      if (!isCmdK) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const run = React.useCallback((fn: () => void) => {
    setOpen(false);
    fn();
  }, []);

  const startNewChatDisabled = !selectedProject;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogTitle>Command palette</DialogTitle>
        <Command label="Command palette">
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem
                value="start new chat"
                disabled={startNewChatDisabled}
                onSelect={() => {
                  if (!selectedProject) return;
                  run(() => onStartNewChat(selectedProject));
                }}
              >
                <MessageSquarePlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1">Start new chat</span>
                {startNewChatDisabled && (
                  <span className="text-xs text-muted-foreground">Select a project first</span>
                )}
              </CommandItem>
              <CommandItem
                value="open settings"
                onSelect={() => run(onOpenSettings)}
              >
                <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1">Open settings</span>
              </CommandItem>
              <CommandItem
                value="toggle theme dark light mode"
                onSelect={() => run(toggleDarkMode)}
              >
                <SunMoon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1">Toggle theme</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
