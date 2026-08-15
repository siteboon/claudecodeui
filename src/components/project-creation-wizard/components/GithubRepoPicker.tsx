import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Command,
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
  /**
   * Called instead of onChange when the value comes from picking a repo out of
   * the list rather than typing. Selection carries more meaning than a
   * keystroke: the repo was found through an authenticated search, so the
   * caller may want to line the clone up with the same token.
   */
  onSelectRepo?: (cloneUrl: string) => void;
  onTokenChange: (tokenId: string) => void;
};

// Breathing room kept against the viewport edge when measuring how much room
// the panel has. Not a visual gap.
const VIEWPORT_EDGE_GAP = 8;
// Visual gap between the input and the panel. Small on purpose: the panel is
// its own bordered box, so a large offset reads as an unrelated floating card.
const ANCHOR_OFFSET = 4;
const MAX_LIST_HEIGHT = 240;

// Popover-style positioning: portal-rendered and `position: fixed` off the
// input's own rect, so it escapes the wizard modal's clipped/scrollable
// container instead of being laid out in-flow underneath it.
const getDropdownPosition = (anchor: DOMRect) => {
  const spaceBelow = window.innerHeight - anchor.bottom - ANCHOR_OFFSET - VIEWPORT_EDGE_GAP;
  const spaceAbove = anchor.top - ANCHOR_OFFSET - VIEWPORT_EDGE_GAP;
  const openUpward = spaceBelow < MAX_LIST_HEIGHT && spaceAbove > spaceBelow;
  const availableHeight = Math.max(openUpward ? spaceAbove : spaceBelow, 0);

  const panelStyle: CSSProperties = {
    position: 'fixed',
    left: anchor.left,
    width: anchor.width,
    ...(openUpward
      ? { bottom: window.innerHeight - anchor.top + ANCHOR_OFFSET }
      : { top: anchor.bottom + ANCHOR_OFFSET }),
  };

  // The height cap belongs to the scrolling element (the list), not to this
  // wrapper — capping both is what produced two nested scrollbars.
  return { panelStyle, listMaxHeight: Math.min(MAX_LIST_HEIGHT, availableHeight) };
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
  onSelectRepo,
  onTokenChange,
}: GithubRepoPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] =
    useState<ReturnType<typeof getDropdownPosition> | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const { repos, loading, error } = useGithubRepoSearch({
    tokenId,
    query: value,
    enabled: Boolean(tokenId) && isOpen,
  });

  // The panel is positioned off the input's viewport rect, so it has to follow
  // that rect for as long as it's open. Watching resize/scroll isn't enough:
  // typing reveals the GitHub authentication card below, which grows the
  // vertically-centred wizard modal and slides the input up by ~90px. No event
  // reports that, so the panel would stay pinned where it opened and drift far
  // from the field. Re-reading the rect each frame (what floating-ui's
  // autoUpdate does in animationFrame mode) covers every cause of movement;
  // state only changes when the computed position actually does.
  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    let frame = 0;
    let lastPosition = '';

    const syncPosition = () => {
      if (anchorRef.current) {
        const nextPosition = getDropdownPosition(anchorRef.current.getBoundingClientRect());
        const signature = JSON.stringify(nextPosition);
        if (signature !== lastPosition) {
          lastPosition = signature;
          setDropdownPosition(nextPosition);
        }
      }
      frame = window.requestAnimationFrame(syncPosition);
    };

    syncPosition();
    return () => window.cancelAnimationFrame(frame);
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
    if (disabled) {
      return;
    }
    (onSelectRepo ?? onChange)(cloneUrl);
    setIsOpen(false);
  };

  const trimmedQuery = value.trim();
  const hasNoMatches = !loading && !error && repos.length === 0;

  // The panel stays mounted for as long as the field is focused. Hiding it when
  // a search returns nothing looked exactly like a broken search: the list
  // vanished mid-typing with no explanation.
  //
  // `disabled` closes it, though: the panel is portaled to document.body, so a
  // disabled input would otherwise sit under a list that still takes clicks.
  // The wizard unmounts this whole step before it starts creating, so that
  // can't happen today — but honouring the prop for the input and not the list
  // is the kind of gap that only stays harmless by accident.
  const showDropdown = isOpen && !disabled;

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
      {/* [&>div]:border-b-0 drops the input's built-in bottom rule. It exists to
          separate the input from a list rendered directly beneath it inside the
          same box; with the list portaled away it just doubles up with this
          element's own border and reads as dead space. The input wrapper is the
          only DOM child here — the portal mounts on document.body. */}
      <Command
        shouldFilter={false}
        className="rounded-lg border border-gray-300 dark:border-gray-600 [&>div]:border-b-0"
      >
        <CommandInput
          value={value}
          onValueChange={onChange}
          onFocus={() => setIsOpen(true)}
          placeholder={t('projectWizard.step2.searchPlaceholder')}
          disabled={disabled}
        />

        {showDropdown && dropdownPosition && createPortal(
          <div
            ref={dropdownRef}
            style={dropdownPosition.panelStyle}
            // z-[70] because the wizard modal itself sits at z-[60]: this panel
            // is portaled to document.body, so a lower value paints it behind
            // the modal and the list is invisible even though it rendered.
            className="z-[70] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            <CommandList style={{ maxHeight: dropdownPosition.listMaxHeight }}>
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

              {hasNoMatches && (
                <p className="px-3 py-2 text-left text-sm text-gray-500 dark:text-gray-400">
                  {trimmedQuery
                    ? t('projectWizard.step2.noRepositoryMatches', { query: trimmedQuery })
                    : t('projectWizard.step2.noRepositoriesFound')}
                </p>
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
