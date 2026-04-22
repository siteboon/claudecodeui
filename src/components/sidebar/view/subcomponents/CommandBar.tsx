import { useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Search, Plus } from 'lucide-react';

export type CommandBarHandle = {
  focus: () => void;
};

type CommandBarProps = {
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onCreateSession: () => void;
  activeProjectName: string;
  resultCount: number;
};

const CommandBar = forwardRef<CommandBarHandle, CommandBarProps>(function CommandBar(
  { searchFilter, onSearchFilterChange, onCreateSession, activeProjectName, resultCount },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const emptyInput = searchFilter.length === 0;
  const showCreateHint = searchFilter.length > 0 && resultCount === 0;

  const triggerCreate = () => {
    onCreateSession();
    onSearchFilterChange('');
  };

  return (
    <div className="border-b border-border/60 px-3 pb-2.5 pt-3">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <span
            className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 text-muted-foreground"
            style={showCreateHint ? { color: 'var(--project-accent)' } : undefined}
          >
            {showCreateHint ? (
              <Plus className="h-3.5 w-3.5" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </span>
          <input
            ref={inputRef}
            value={searchFilter}
            onChange={(e) => onSearchFilterChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (showCreateHint || emptyInput)) {
                e.preventDefault();
                triggerCreate();
              }
            }}
            placeholder={`Search or create in @${activeProjectName}...`}
            className="w-full rounded-md border bg-background py-1.5 pl-8 pr-10 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground"
            style={{
              borderColor: focused ? 'var(--project-accent)' : 'hsl(var(--border))',
            }}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">
            {showCreateHint ? '⏎' : '⌘K'}
          </span>
        </div>
        <button
          type="button"
          onClick={triggerCreate}
          title={`New session in @${activeProjectName} (⌘N)`}
          aria-label={`New session in @${activeProjectName}`}
          className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-md transition-colors"
          style={{
            background: 'color-mix(in srgb, var(--project-accent) 14%, transparent)',
            color: 'var(--project-accent)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background =
              'color-mix(in srgb, var(--project-accent) 22%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              'color-mix(in srgb, var(--project-accent) 14%, transparent)';
          }}
        >
          <Plus className="h-4 w-4" strokeWidth={2.25} />
        </button>
      </div>
      {showCreateHint && (
        <div className="mt-1.5 pl-0.5 text-[11px] text-muted-foreground">
          ⏎ New session in{' '}
          <span style={{ color: 'var(--project-accent)' }}>
            @{activeProjectName}
          </span>
        </div>
      )}
    </div>
  );
});

export default CommandBar;
