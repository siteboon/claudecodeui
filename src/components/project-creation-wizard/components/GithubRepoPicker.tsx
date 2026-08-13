import { useEffect, useRef, useState } from 'react';
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
  tokenId: string;
  availableTokens: GithubTokenCredential[];
  disabled?: boolean;
  onSelectRepo: (cloneUrl: string) => void;
  onTokenChange: (tokenId: string) => void;
  onUseManualUrl: () => void;
};

export default function GithubRepoPicker({
  tokenId,
  availableTokens,
  disabled = false,
  onSelectRepo,
  onTokenChange,
  onUseManualUrl,
}: GithubRepoPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { repos, loading, error } = useGithubRepoSearch({
    tokenId,
    query,
    enabled: Boolean(tokenId),
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current || !(event.target instanceof Node)) {
        return;
      }
      if (!containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelectRepo = (cloneUrl: string) => {
    onSelectRepo(cloneUrl);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
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

      <Command shouldFilter={false} className="overflow-visible rounded-lg border border-gray-300 dark:border-gray-600">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          onFocus={() => setIsOpen(true)}
          placeholder={t('projectWizard.step2.searchPlaceholder')}
          disabled={disabled}
        />

        {isOpen && (
          <CommandList className="max-h-60 border-t border-gray-200 dark:border-gray-700">
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
        )}
      </Command>

      <button
        type="button"
        onClick={onUseManualUrl}
        className="mt-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
      >
        {t('projectWizard.step2.editUrlManually')}
      </button>
    </div>
  );
}
