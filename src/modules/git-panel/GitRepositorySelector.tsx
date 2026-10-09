import { Check, ChevronDown, FolderGit2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GitRepositorySummary } from '@/shared/types';

type GitRepositorySelectorProps = {
  isMobile: boolean;
  repositories: GitRepositorySummary[];
  selectedPath: string;
  onSelect: (path: string) => void;
};

/** Rendered by GitPanel when a project holds several repositories, to pick the one the panel operates on. */
export default function GitRepositorySelector({
  isMobile,
  repositories,
  selectedPath,
  onSelect,
}: GitRepositorySelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const close = () => {
    setIsOpen(false);
    setSearchQuery('');
  };

  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredRepositories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return repositories;
    }
    return repositories.filter((repository) => repository.path.toLowerCase().includes(query)
      || repository.name.toLowerCase().includes(query));
  }, [repositories, searchQuery]);

  const selectedLabel = selectedPath || t('git:repository.root');

  return (
    <div className={`border-b border-border/60 ${isMobile ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => (isOpen ? close() : setIsOpen(true))}
          className={`flex max-w-full items-center rounded-lg transition-colors hover:bg-accent ${isMobile ? 'space-x-1 px-2 py-1' : 'space-x-2 px-3 py-1.5'}`}
          title={t('git:repository.label')}
        >
          <FolderGit2 className={`shrink-0 text-muted-foreground ${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`} />
          <span className={`truncate font-medium ${isMobile ? 'text-xs' : 'text-sm'}`}>{selectedLabel}</span>
          <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('git:repository.search')}
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  title={t('git:header.clearSearch')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {filteredRepositories.length === 0 ? (
                <div className="px-4 py-3 text-center text-sm text-muted-foreground">{t('git:repository.noMatches')}</div>
              ) : (
                filteredRepositories.map((repository) => {
                  const isSelected = repository.path === selectedPath;
                  return (
                    <button
                      key={repository.path}
                      onClick={() => {
                        onSelect(repository.path);
                        close();
                      }}
                      className={`w-full px-4 py-2 text-left text-sm transition-colors hover:bg-accent ${
                        isSelected ? 'bg-accent/50 text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      <span className="flex items-center space-x-2">
                        {isSelected && <Check className="h-3 w-3 shrink-0 text-primary" />}
                        <span className={`truncate ${isSelected ? 'font-medium' : ''}`}>
                          {repository.path || t('git:repository.root')}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
