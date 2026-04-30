import * as React from 'react';
import { useNavigate } from 'react-router-dom';

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
import type { AppTab, Project } from '../../types/app';

import { GROUPS, parseMode } from './registry';
import type { GroupConfig, PaletteCtx } from './registry';

type CommandPaletteProps = {
  selectedProject: Project | null;
  onStartNewChat: (project: Project) => void;
  onOpenSettings: (tab?: string) => void;
  onShowTab?: (tab: AppTab) => void;
};

export default function CommandPalette({
  selectedProject,
  onStartNewChat,
  onOpenSettings,
  onShowTab,
}: CommandPaletteProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const { toggleDarkMode } = useTheme();
  const navigate = useNavigate();

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

  React.useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const { mode, query } = parseMode(search);
  const projectId = selectedProject?.projectId;

  const run = React.useCallback((fn: () => void) => {
    setOpen(false);
    fn();
  }, []);

  const openFile = React.useCallback((path: string) => {
    window.openFile?.(path);
  }, []);

  const filter = React.useCallback(
    (value: string, rawSearch: string) => {
      const stripped = parseMode(rawSearch).query.trim().toLowerCase();
      if (!stripped) return 1;
      return value.toLowerCase().includes(stripped) ? 1 : 0;
    },
    [],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogTitle>Command palette</DialogTitle>
        <Command label="Command palette" filter={filter}>
          <CommandInput
            placeholder="Type to search — prefix with > for actions, / for files, # for commits"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {GROUPS.map((group) => (
              <GroupSlot
                key={group.id}
                group={group}
                mode={mode}
                ctx={{
                  projectId,
                  selectedProject,
                  query,
                  enabled: open && group.modes.includes(mode) && (!group.requiresProject || !!projectId),
                  open,
                  run,
                  navigate,
                  toggleDarkMode,
                  onStartNewChat,
                  onOpenSettings,
                  onShowTab,
                  openFile,
                }}
              />
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function GroupSlot({ group, mode, ctx }: { group: GroupConfig; mode: string; ctx: PaletteCtx }) {
  const items = group.useItems(ctx);
  const eligible = group.modes.includes(mode) && (!group.requiresProject || !!ctx.projectId);
  if (!eligible || items.length === 0) return null;
  return (
    <CommandGroup heading={group.heading}>
      {items.map((item) => (
        <CommandItem
          key={item.key}
          value={item.value}
          disabled={item.disabled}
          onSelect={item.onSelect}
        >
          {item.node}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
