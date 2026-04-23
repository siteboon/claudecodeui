import { useEffect, useState } from 'react';
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
  // Mirror the Command root's search string by observing the input directly.
  // Command.tsx owns the canonical search state in its context and doesn't
  // expose it to the outside world; we peek via onInput so this hook can
  // drive without modifying Command.tsx.
  const [query, setQuery] = useState('');

  // Command.tsx unmounts the input on Dialog close so its canonical search
  // resets to ''. Our mirrored query needs to follow — otherwise a re-open
  // would race an old query against a fresh (empty) input.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

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
    const match = sessions.find((s) => s.id === r.sessionId);
    if (match) {
      onSelectSession(match);
    }
    // If the sessionId doesn't resolve (archived, not yet loaded, stale
    // index) close silently rather than crash or toast — see plan §6(b).
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
    `new session ${activeProjectName}`,
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
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !showActionsGroup &&
                !showProjectsGroup &&
                !showSessionsGroup &&
                transcriptResults.length > 0
              ) {
                e.preventDefault();
                e.stopPropagation();
                handleTranscriptSelect(transcriptResults[0]);
              }
            }}
          />
          <CommandList className="max-h-[440px]">
            {!showTranscriptGroup && <CommandEmpty>No results found.</CommandEmpty>}

            {showActionsGroup && (
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
