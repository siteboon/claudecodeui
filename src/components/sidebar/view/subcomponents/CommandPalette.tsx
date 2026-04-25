import { useEffect, useRef, useState } from 'react';
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
import { useTranscriptSearch, type TranscriptSessionResult } from '../../hooks/useTranscriptSearch';

import { KbdCombo } from './Kbd';
import { MOD_KEY, ALT_KEY, SHIFT_KEY } from './shortcuts';
import TranscriptMatchRow from './TranscriptMatchRow';

const TRANSCRIPT_MIN_CHARS = 3;

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: FlatSession[];
  railItems: ProjectRailItemData[];
  activeProjectName: string;
  hasSelectedSession: boolean;
  hasActiveFilter: boolean;
  onSelectSession: (session: FlatSession) => void;
  onSelectSessionInNewPane: (session: FlatSession) => void;
  onSelectTranscriptResult: (result: TranscriptSessionResult) => void;
  onSelectProject: (projectName: string) => void;
  onNewSession: () => void;
  onNewSessionInProject: (projectName: string) => void;
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
  onSelectSessionInNewPane,
  onSelectTranscriptResult,
  onSelectProject,
  onNewSession,
  onNewSessionInProject,
  onArchiveActiveSession,
  onClearProjectFilter,
  onRefresh,
  onShowSettings,
  onShowShortcuts,
}: CommandPaletteProps) {
  // Track which session is currently highlighted via aria-selected so
  // Shift+Enter can open it in a new pane.
  const listRef = useRef<HTMLDivElement>(null);

  // Handles Shift+Enter whether focus is on the input or a list item.
  // Runs before Command's internal Enter handler (which fires on bubbling to
  // the Command root div). Command.tsx skips onSelect when shiftKey is set,
  // so this handler has sole ownership of Shift+Enter.
  const handleShiftEnter = (e: React.KeyboardEvent) => {
    if (!(e.shiftKey && e.key === 'Enter' && listRef.current)) return;
    const selected = listRef.current.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selected) {
      const sessionId = selected.dataset.sessionId;
      if (sessionId) {
        const session = sessions.find((s) => s.id === sessionId);
        if (session) {
          e.preventDefault();
          e.stopPropagation();
          console.log('[palette] shift+enter → new pane', session.id);
          onSelectSessionInNewPane(session);
          onOpenChange(false);
        }
      }
    }
  };

  // Mirror the Command root's search string by observing the input directly.
  const [query, setQuery] = useState('');

  // Project cycle: Tab / Shift+Tab in the input cycles which project the
  // "New session" action targets. Initialises to the active project on open.
  const [cycleIdx, setCycleIdx] = useState(0);
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const idx = railItems.findIndex(
      (p) => p.name === activeProjectName || p.displayName === activeProjectName,
    );
    setCycleIdx(Math.max(0, idx));
  }, [open, activeProjectName, railItems]);

  const cycledProject = railItems.length > 0 ? railItems[cycleIdx] : null;
  const cycledProjectName = cycledProject
    ? (cycledProject.displayName || cycledProject.name)
    : activeProjectName;

  const handleTabCycle = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || railItems.length < 2) return;
    e.preventDefault();
    setCycleIdx((prev) =>
      e.shiftKey
        ? (prev - 1 + railItems.length) % railItems.length
        : (prev + 1) % railItems.length,
    );
  };

  const { results: transcriptResults, isSearching: isTranscriptSearching } = useTranscriptSearch({
    query,
    enabled: open,
    minChars: TRANSCRIPT_MIN_CHARS,
  });

  const run = (fn: () => void) => () => {
    fn();
    onOpenChange(false);
  };

  const handleTranscriptSelect = (r: TranscriptSessionResult) => {
    onSelectTranscriptResult(r);
    onOpenChange(false);
  };

  const showTranscriptGroup =
    query.trim().length >= TRANSCRIPT_MIN_CHARS &&
    (transcriptResults.length > 0 || isTranscriptSearching);

  // Mirror Command.tsx's visibility filter (substring match on lowercased
  // `value` prop) so we can suppress group headings whose items all collapse
  // for the current query. Keeping this in the render site avoids touching
  // Command.tsx and keeps the data-flow one-way.
  const normalizedQuery = query.toLowerCase();
  const matchesQuery = (value: string) =>
    !normalizedQuery || value.toLowerCase().includes(normalizedQuery);

  const actionValues = [
    `new session ${cycledProjectName}`,
    ...(hasSelectedSession ? ['archive current session'] : []),
    ...(hasActiveFilter ? ['clear project filter'] : []),
    'refresh projects',
    'open settings',
    'keyboard shortcuts help',
  ];
  const showActionsGroup = actionValues.some(matchesQuery);
  const showProjectsGroup =
    railItems.length > 0 &&
    railItems.some((p) => matchesQuery(`project ${p.displayName || p.name}`));
  const showSessionsGroup =
    sessions.length > 0 &&
    sessions.some((s) => matchesQuery(`session ${s.summary || s.id} ${s.__projectDisplayName}`));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogTitle>Command Palette</DialogTitle>
        <Command tabCategory="project">
          <CommandInput
            placeholder="Type a command or search sessions and transcripts…"
            autoFocus
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { handleTabCycle(e); handleShiftEnter(e); }}
          />
          <CommandList ref={listRef} className="max-h-[440px]" onKeyDown={handleShiftEnter}>
            {!showTranscriptGroup && <CommandEmpty>No results found.</CommandEmpty>}

            {showActionsGroup && (
            <CommandGroup heading="Actions">
              <CommandItem
                value={`new session ${cycledProjectName}`}
                onSelect={run(() =>
                  cycledProject
                    ? onNewSessionInProject(cycledProject.name)
                    : onNewSession()
                )}
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                <span>
                  New session in{' '}
                  <span style={{ color: 'var(--project-accent)' }}>@{cycledProjectName}</span>
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {railItems.length > 1 && (
                    <span className="text-[10px] text-muted-foreground/50">Tab to switch</span>
                  )}
                  <KbdCombo keys={[ALT_KEY, 'N']} />
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
                    <KbdCombo keys={[ALT_KEY, 'A']} />
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
            )}

            {showProjectsGroup && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Projects">
                  {railItems.map((project, index) => (
                    <CommandItem
                      key={project.name}
                      value={`project ${project.displayName || project.name}`}
                      category="project"
                      onSelect={run(() => onSelectProject(project.name))}
                    >
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{project.displayName || project.name}</span>
                      {index < 6 && (
                        <div className="ml-auto">
                          <KbdCombo keys={[ALT_KEY, SHIFT_KEY, String(index + 1)]} />
                        </div>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {showSessionsGroup && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Sessions">
                  {sessions.map((session, index) => {
                    const title = session.summary || session.id;
                    return (
                      <CommandItem
                        key={session.id}
                        value={`session ${title} ${session.__projectDisplayName}`}
                        data-session-id={session.id}
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
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">
                    {SHIFT_KEY}↵ opens in new pane
                  </div>
                </CommandGroup>
              </>
            )}

            {showTranscriptGroup && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Transcript matches">
                  {transcriptResults.length === 0 && isTranscriptSearching ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground" role="status">
                      Searching transcripts…
                    </div>
                  ) : (
                    transcriptResults.map((r) => (
                      <TranscriptMatchRow
                        key={`${r.projectName}:${r.sessionId}`}
                        result={r}
                        onSelect={() => handleTranscriptSelect(r)}
                      />
                    ))
                  )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
