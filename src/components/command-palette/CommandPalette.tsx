import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Bot,
  FileText,
  GitBranch,
  GitCommit,
  Info,
  KeyRound,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  Palette,
  Plug,
  Settings,
  SunMoon,
} from 'lucide-react';

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

import { useSessionsSource } from './sources/useSessionsSource';
import { useFilesSource } from './sources/useFilesSource';
import { useCommitsSource } from './sources/useCommitsSource';
import { useSessionMessageSearch } from './sources/useSessionMessageSearch';

type Mode = 'mixed' | 'actions' | 'files' | 'commits';

type CommandPaletteProps = {
  selectedProject: Project | null;
  onStartNewChat: (project: Project) => void;
  onOpenSettings: (tab?: string) => void;
  onShowTab?: (tab: AppTab) => void;
};

function parseMode(input: string): { mode: Mode; query: string } {
  if (input.startsWith('> ')) return { mode: 'actions', query: input.slice(2) };
  if (input.startsWith('/')) return { mode: 'files', query: input.slice(1) };
  if (input.startsWith('#')) return { mode: 'commits', query: input.slice(1) };
  return { mode: 'mixed', query: input };
}

const SETTINGS_TABS: Array<{ id: string; label: string; keywords: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'agents', label: 'Agents', keywords: 'agents subagents claude code', icon: Bot },
  { id: 'appearance', label: 'Appearance', keywords: 'appearance theme dark light language', icon: Palette },
  { id: 'git', label: 'Git', keywords: 'git github commits', icon: GitBranch },
  { id: 'api', label: 'API Tokens', keywords: 'api tokens auth keys', icon: KeyRound },
  { id: 'tasks', label: 'Tasks', keywords: 'tasks taskmaster', icon: ListChecks },
  { id: 'notifications', label: 'Notifications', keywords: 'notifications alerts push', icon: Bell },
  { id: 'plugins', label: 'Plugins', keywords: 'plugins extensions integrations', icon: Plug },
  { id: 'about', label: 'About', keywords: 'about version info', icon: Info },
];

const NAV_TABS: Array<{ id: AppTab; label: string; keywords: string }> = [
  { id: 'chat', label: 'Go to Chat', keywords: 'chat messages conversation' },
  { id: 'files', label: 'Go to Files', keywords: 'files file tree explorer' },
  { id: 'shell', label: 'Go to Shell', keywords: 'shell terminal console' },
  { id: 'git', label: 'Go to Git', keywords: 'git diff branches' },
  { id: 'tasks', label: 'Go to Tasks', keywords: 'tasks taskmaster' },
];

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
  const { items: sessions } = useSessionsSource(projectId, open && (mode === 'mixed'));
  const { items: messageMatches } = useSessionMessageSearch(projectId, query, open && mode === 'mixed');
  const { items: files } = useFilesSource(projectId, open && (mode === 'mixed' || mode === 'files'));
  const { items: commits } = useCommitsSource(projectId, open && (mode === 'mixed' || mode === 'commits'));

  const showActions = mode === 'mixed' || mode === 'actions';
  const showSessions = mode === 'mixed';
  const showFiles = mode === 'mixed' || mode === 'files';
  const showCommits = mode === 'mixed' || mode === 'commits';

  const sessionRows = React.useMemo(() => {
    if (!showSessions) return [];
    type Row = { id: string; label: string; provider?: string; snippet?: string };
    const byId = new Map<string, Row>();
    for (const s of sessions) {
      byId.set(s.id, { id: s.id, label: s.label, provider: s.provider });
    }
    for (const m of messageMatches) {
      const existing = byId.get(m.sessionId);
      if (existing) {
        existing.snippet = m.snippet;
      } else {
        byId.set(m.sessionId, {
          id: m.sessionId,
          label: m.label,
          provider: m.provider,
          snippet: m.snippet,
        });
      }
    }
    return Array.from(byId.values());
  }, [sessions, messageMatches, showSessions]);

  const filter = React.useCallback(
    (value: string, rawSearch: string) => {
      const stripped = parseMode(rawSearch).query.trim().toLowerCase();
      if (!stripped) return 1;
      return value.toLowerCase().includes(stripped) ? 1 : 0;
    },
    [],
  );

  const run = React.useCallback((fn: () => void) => {
    setOpen(false);
    fn();
  }, []);

  const startNewChatDisabled = !selectedProject;

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

            {showActions && (
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
                <CommandItem value="open settings" onSelect={() => run(() => onOpenSettings())}>
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
            )}

            {showActions && (
              <CommandGroup heading="Navigate">
                {NAV_TABS.map((tab) => (
                  <CommandItem
                    key={tab.id as string}
                    value={`navigate ${tab.label} ${tab.keywords}`}
                    onSelect={() => run(() => onShowTab?.(tab.id))}
                  >
                    <span className="flex-1">{tab.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showActions && (
              <CommandGroup heading="Settings">
                {SETTINGS_TABS.map(({ id, label, keywords, icon: Icon }) => (
                  <CommandItem
                    key={id}
                    value={`settings ${label} ${keywords}`}
                    onSelect={() => run(() => onOpenSettings(id))}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex-1">Settings: {label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showSessions && sessionRows.length > 0 && (
              <CommandGroup heading="Sessions">
                {sessionRows.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`session ${s.label} ${s.id} ${s.snippet ?? ''}`}
                    onSelect={() => run(() => navigate(`/session/${s.id}`))}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{s.label}</span>
                      {s.snippet && (
                        <span className="truncate text-xs text-muted-foreground">{s.snippet}</span>
                      )}
                    </div>
                    {s.provider && (
                      <span className="text-xs text-muted-foreground">{s.provider}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showFiles && files.length > 0 && (
              <CommandGroup heading="Files">
                {files.map((f) => (
                  <CommandItem
                    key={f.path}
                    value={`file ${f.path}`}
                    onSelect={() => run(() => window.openFile?.(f.path))}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{f.path}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showCommits && commits.length > 0 && (
              <CommandGroup heading="Commits">
                {commits.map((c) => (
                  <CommandItem
                    key={c.hash}
                    value={`commit ${c.shortHash} ${c.message} ${c.author}`}
                    onSelect={() => run(() => onShowTab?.('git'))}
                  >
                    <GitCommit className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="font-mono text-xs text-muted-foreground">{c.shortHash}</span>
                    <span className="flex-1 truncate">{c.message}</span>
                    <span className="truncate text-xs text-muted-foreground">{c.author}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
