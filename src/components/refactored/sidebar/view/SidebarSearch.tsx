import { Folder, MessageSquare, Search, X } from 'lucide-react';
import { Input } from '@/shared/view/ui';
import { cn } from '@/lib/utils';
import { SearchMode } from '@/components/refactored/sidebar/types/index.js';


type SidebarSearchProps = {
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  searchFilter: string;
  onSearchFilterChange: (filter: string) => void;
};

export function SidebarSearch({
  searchMode,
  onSearchModeChange,
  searchFilter,
  onSearchFilterChange
}: SidebarSearchProps) {
  return (
    <div className="mt-2.5 space-y-2">
      <div className="flex rounded-lg bg-muted/50 p-0.5">
        <button
          onClick={() => onSearchModeChange('projects')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
            searchMode === 'projects'
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Folder className="h-3 w-3" />
          Projects
        </button>
        <button
          onClick={() => onSearchModeChange('conversations')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
            searchMode === 'conversations'
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MessageSquare className="h-3 w-3" />
          Conversations
        </button>
      </div>
      
      {/* Search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50 md:h-3.5 md:w-3.5" />
        <Input
          type="text"
          placeholder={searchMode === 'conversations' ? "Search conversations..." : "Search projects..."}
          value={searchFilter}
          onChange={(event) => onSearchFilterChange(event.target.value)}
          className="nav-search-input h-10 rounded-xl border-0 pl-10 pr-9 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 md:h-9 md:pl-9 md:pr-8"
        />
        {searchFilter && (
          <button
            onClick={() => onSearchFilterChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-accent md:p-0.5"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground md:h-3 md:w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
