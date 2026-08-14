import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../../shared/view/ui';
import { useGithubRepoSearch } from '../hooks/useGithubRepoSearch';
import type { GithubTokenCredential } from '../types';

type GithubRepoPickerProps = {
  value: string;
  tokenId: string;
  availableTokens: GithubTokenCredential[];
  disabled?: boolean;
  onChange: (value: string) => void;
  onTokenChange: (tokenId: string) => void;
};

const EDGE_GAP = 8;
const MAX_LIST_HEIGHT = 240;

// Popover-style positioning: portal-rendered and `position: fixed` off the
// input's own rect, so it escapes the wizard modal's clipped/scrollable
// container instead of being laid out in-flow underneath it.
const getDropdownPosition = (anchor: DOMRect): CSSProperties => {
  const spaceBelow = window.innerHeight - anchor.bottom - EDGE_GAP;
  const spaceAbove = anchor.top - EDGE_GAP;
  const openUpward = spaceBelow < MAX_LIST_HEIGHT && spaceAbove > spaceBelow;

  return {
    position: 'fixed',
    left: anchor.left,
    width: anchor.width,
    maxHeight: Math.min(MAX_LIST_HEIGHT, Math.max(spaceBelow, spaceAbove)),
    ...(openUpward
      ? { bottom: window.innerHeight - anchor.top + EDGE_GAP }
      : { top: anchor.bottom + EDGE_GAP }),
  };
};

// One field for both: free text (paste a URL, used as-is) and a live search
// dropdown of matching repos (selecting one overwrites the field). No mode
// switch — whatever is typed is always the value the wizard uses.
export default function GithubRepoPicker({
  value,
  tokenId,
  availableTokens,
  disabled = false,
  onChange,
  onTokenChange,
}: GithubRepoPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const { repos, loading, error } = useGithubRepoSearch({
    tokenId,
    query: value,
    enabled: Boolean(tokenId) && isOpen,
  });

  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) {
      return;
    }

    const updatePosition = () => {
      if (anchorRef.current) {
        setDropdownStyle(getDropdownPosition(anchorRef.current.getBoundingClientRect()));
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (anchorRef.current?.contains(event.target) || dropdownRef.current?.contains(event.target)) {
        return;
      }
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelectRepo = (cloneUrl: string) => {
    onChange(cloneUrl);
    setIsOpen(false);
  };

  const showDropdown = isOpen && (loading || Boolean(error) || repos.length > 0 || value.trim().length === 0);

  return (
    <div ref={anchorRef} className="relative">
      {availableTokens.length > 1 && (
        <select
          value={tokenId}
          onChange={(event) => onTokenChange(event.target.value)}
          disabled={disabled}
          className="mb-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
        >
          {availableTokens.map((token) => (
            <option key={token.id} value={String(token.id)}>
              {token.credential_name}
            </option>
          ))}
        </select>
      )}

      {/* CommandInput (in place) and the portaled CommandList below both need
          to stay inside this single Command root — it's the shared cmdk
          context that wires the input's value to keyboard nav/selection in
          the list. createPortal keeps that React context even though the
          list mounts on a different DOM node. */}
      <Command shouldFilter={false} className="rounded-lg border border-gray-300 dark:border-gray-600">
        <CommandInput
          value={value}
          onValueChange={onChange}
          onFocus={() => setIsOpen(true)}
          placeholder={t('projectWizard.step2.searchPlaceholder')}
          disabled={disabled}
        />

        {showDropdown && dropdownStyle && createPortal(
          <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="z-50 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            <CommandList>
              {loading && (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('projectWizard.step2.searchingRepositories')}
                </div>
              )}

              {!loading && error && (
                <p className="px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {t('projectWizard.step2.repoSearchError', { message: error })}
                </p>
              )}

              {!loading && !error && (
                <CommandEmpty className="px-3 py-2 text-left text-sm text-gray-500 dark:text-gray-400">
                  {t('projectWizard.step2.noRepositoriesFound')}
                </CommandEmpty>
              )}

              {!loading && !error && repos.map((repo) => (
                <CommandItem
                  key={repo.id}
                  value={repo.fullName}
                  onSelect={() => handleSelectRepo(repo.cloneUrl)}
                  className="flex-col items-start gap-0.5"
                >
                  <div className="flex w-full items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">{repo.fullName}</span>
                    {repo.private && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t('projectWizard.step2.privateRepo')}
                      </Badge>
                    )}
                  </div>
                  {repo.description && (
                    <span className="line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                      {repo.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandList>
          </div>,
          document.body,
        )}
      </Command>
    </div>
  );
}
