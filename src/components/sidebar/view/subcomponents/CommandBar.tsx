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

  const showCreate = searchFilter.length > 0 && resultCount === 0;

  return (
    <div className="border-b border-border/60 px-3 pb-2.5 pt-3">
      <div className="relative">
        <span
          className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 text-muted-foreground"
          style={showCreate ? { color: 'var(--project-accent)' } : undefined}
        >
          {showCreate ? (
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
            if (e.key === 'Enter' && showCreate) {
              onCreateSession();
              onSearchFilterChange('');
            }
          }}
          placeholder={`Search or create in @${activeProjectName}...`}
          className="w-full rounded-md border bg-background py-1.5 pl-8 pr-10 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground"
          style={{
            borderColor: focused ? 'var(--project-accent)' : 'hsl(var(--border))',
          }}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">
          {showCreate ? '⏎' : '⌘K'}
        </span>
      </div>
      {showCreate && (
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
