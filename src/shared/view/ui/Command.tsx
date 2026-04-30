import * as React from 'react';
import { Search } from 'lucide-react';

import { cn } from '../../../lib/utils';

/*
 * Lightweight command palette — inspired by cmdk but no external deps.
 *
 * Architecture:
 * - Command owns the search string and a flat list of registered item values.
 * - Items register via context on mount and deregister on unmount.
 * - Filtering, active index, and keyboard nav happen centrally in Command.
 * - Items read their "is visible" / "is active" state from context.
 */

interface ItemEntry {
  id: string;
  value: string;       // searchable text (lowercase)
  onSelect: () => void;
  element: HTMLElement | null;
}

interface CommandContextValue {
  search: string;
  setSearch: (value: string) => void;
  /** Set of visible item IDs after filtering (derived state, not a ref). */
  visibleIds: Set<string>;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  register: (entry: ItemEntry) => void;
  unregister: (id: string) => void;
  updateEntry: (id: string, patch: Partial<Pick<ItemEntry, 'value' | 'onSelect' | 'element'>>) => void;
}

const CommandContext = React.createContext<CommandContextValue | null>(null);

function useCommand() {
  const ctx = React.useContext(CommandContext);
  if (!ctx) throw new Error('Command components must be used within <Command>');
  return ctx;
}

/* ─── Command (root) ─────────────────────────────────────────────── */

type CommandProps = React.HTMLAttributes<HTMLDivElement>;

const Command = React.forwardRef<HTMLDivElement, CommandProps>(
  ({ className, children, ...props }, ref) => {
    const [search, setSearch] = React.useState('');
    const entriesRef = React.useRef<Map<string, ItemEntry>>(new Map());
    // Bump this counter whenever the entry set changes so derived state recalculates
    const [revision, setRevision] = React.useState(0);

    const register = React.useCallback((entry: ItemEntry) => {
      entriesRef.current.set(entry.id, entry);
      setRevision(r => r + 1);
    }, []);

    const unregister = React.useCallback((id: string) => {
      entriesRef.current.delete(id);
      setRevision(r => r + 1);
    }, []);

    const updateEntry = React.useCallback((id: string, patch: Partial<Pick<ItemEntry, 'value' | 'onSelect' | 'element'>>) => {
      const existing = entriesRef.current.get(id);
      if (existing) {
        Object.assign(existing, patch);
      }
    }, []);

    // Derive visible IDs from search + entries
    const visibleIds = React.useMemo(() => {
      const lowerSearch = search.toLowerCase();
      const ids = new Set<string>();
      for (const [id, entry] of entriesRef.current) {
        if (!lowerSearch || entry.value.includes(lowerSearch)) {
          ids.add(id);
        }
      }
      return ids;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, revision]);

    // Ordered list of visible entries (preserves DOM order via insertion order)
    const visibleEntries = React.useMemo(() => {
      const result: ItemEntry[] = [];
      for (const [, entry] of entriesRef.current) {
        if (visibleIds.has(entry.id)) result.push(entry);
      }
      return result;
    }, [visibleIds]);

    // Active item tracking
    const [activeId, setActiveId] = React.useState<string | null>(null);

    // Reset active to first visible item when search or visible set changes
    React.useEffect(() => {
      setActiveId(visibleEntries.length > 0 ? visibleEntries[0].id : null);
    }, [visibleEntries]);

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
      } else {
        return;
      }

      const entries = visibleEntries;
      if (entries.length === 0) return;

      if (e.key === 'Enter') {
        const active = entries.find(entry => entry.id === activeId);
        active?.onSelect();
        return;
      }

      const currentIndex = entries.findIndex(entry => entry.id === activeId);
      let nextIndex: number;
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < entries.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : entries.length - 1;
      }
      const nextId = entries[nextIndex].id;
      setActiveId(nextId);

      // Scroll the active item into view
      const nextEntry = entries[nextIndex];
      nextEntry.element?.scrollIntoView({ block: 'nearest' });
    }, [visibleEntries, activeId]);

    const value = React.useMemo<CommandContextValue>(
      () => ({ search, setSearch, visibleIds, activeId, setActiveId, register, unregister, updateEntry }),
      [search, visibleIds, activeId, register, unregister, updateEntry]
    );

    return (
      <CommandContext.Provider value={value}>
        <div
          ref={ref}
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          className={cn('flex flex-col', className)}
          onKeyDown={handleKeyDown}
          {...props}
        >
          {children}
        </div>
      </CommandContext.Provider>
    );
  }
);
Command.displayName = 'Command';

/* ─── CommandInput ───────────────────────────────────────────────── */

type CommandInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'>;

const CommandInput = React.forwardRef<HTMLInputElement, CommandInputProps>(
  ({ className, placeholder = 'Search...', ...props }, ref) => {
    const { search, setSearch } = useCommand();

    return (
      <div className="flex items-center border-b px-3" role="presentation">
        <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={ref}
          type="text"
          role="searchbox"
          aria-autocomplete="list"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none',
            'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
CommandInput.displayName = 'CommandInput';

/* ─── CommandList ────────────────────────────────────────────────── */

const CommandList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="listbox"
      className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)}
      {...props}
    />
  )
);
CommandList.displayName = 'CommandList';

/* ─── CommandEmpty ───────────────────────────────────────────────── */

const CommandEmpty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { search, visibleIds } = useCommand();

    // Only show when there's a search term and zero matches
    if (!search || visibleIds.size > 0) return null;

    return (
      <div ref={ref} className={cn('py-6 text-center text-sm text-muted-foreground', className)} {...props} />
    );
  }
);
CommandEmpty.displayName = 'CommandEmpty';

/* ─── CommandGroup ───────────────────────────────────────────────── */

interface CommandGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  heading?: React.ReactNode;
}

const CommandGroup = React.forwardRef<HTMLDivElement, CommandGroupProps>(
  ({ className, heading, children, ...props }, ref) => (
    <div ref={ref} className={cn('overflow-hidden p-1', className)} role="group" aria-label={typeof heading === 'string' ? heading : undefined} {...props}>
      {heading && (
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground" role="presentation">
          {heading}
        </div>
      )}
      {children}
    </div>
  )
);
CommandGroup.displayName = 'CommandGroup';

/* ─── CommandItem ────────────────────────────────────────────────── */

interface CommandItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  onSelect?: () => void;
  disabled?: boolean;
}

const CommandItem = React.forwardRef<HTMLDivElement, CommandItemProps>(
  ({ className, value, onSelect, disabled, children, ...props }, ref) => {
    const { visibleIds, activeId, setActiveId, register, unregister, updateEntry } = useCommand();
    const stableId = React.useId();
    const elementRef = React.useRef<HTMLElement | null>(null);
    const searchableText = value || (typeof children === 'string' ? children : '');

    // Register on mount, unregister on unmount
    React.useEffect(() => {
      register({
        id: stableId,
        value: searchableText.toLowerCase(),
        onSelect: onSelect || (() => {}),
        element: elementRef.current,
      });
      return () => unregister(stableId);
      // Only re-register when the identity changes, not onSelect
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stableId, searchableText, register, unregister]);

    // Keep onSelect up-to-date without re-registering
    React.useEffect(() => {
      updateEntry(stableId, { onSelect: onSelect || (() => {}) });
    }, [stableId, onSelect, updateEntry]);

    // Keep element ref up-to-date
    const setRef = React.useCallback((node: HTMLDivElement | null) => {
      elementRef.current = node;
      updateEntry(stableId, { element: node });
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }, [stableId, updateEntry, ref]);

    // Hidden by filter
    if (!visibleIds.has(stableId)) return null;

    const isActive = activeId === stableId;

    return (
      <div
        ref={setRef}
        role="option"
        aria-selected={isActive}
        aria-disabled={disabled || undefined}
        data-active={isActive || undefined}
        className={cn(
          'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
          isActive && 'bg-accent text-accent-foreground',
          disabled && 'pointer-events-none opacity-50',
          className
        )}
        onPointerMove={() => { if (!disabled && activeId !== stableId) setActiveId(stableId); }}
        onClick={() => !disabled && onSelect?.()}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CommandItem.displayName = 'CommandItem';

/* ─── CommandSeparator ───────────────────────────────────────────── */

const CommandSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('-mx-1 h-px bg-border', className)} {...props} />
  )
);
CommandSeparator.displayName = 'CommandSeparator';

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator };
