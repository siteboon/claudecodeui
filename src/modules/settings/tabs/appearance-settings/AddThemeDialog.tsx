import { Check, Download, FileJson, Github, GitBranch, Globe, Loader2, Package, RefreshCw, Search, Upload, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiErrorMessage } from '@/shared/api';
import { useTheme } from '@/shared/context/ThemeContext';
import {
  VsCodeThemeImportError,
  importThemesFromFile,
  isThemeAllowedInSlot,
  parseVsCodeTheme,
  parseVsixThemes,
} from '@/shared/themes';
import type { ColorTheme, ThemeSearchResult, ThemeSearchSort, ThemeSource } from '@/shared/types';
import { Dialog, DialogContent, DialogTitle, Pill, PillBar } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { useThemeSearch } from '@/modules/settings/hooks/useThemeSearch';

type RecommendedTheme = {
  /** `namespace.name` on Open VSX. */
  id: string;
  name: string;
  /** Background, surface and accent of the variant most people use, for the card swatches. */
  colors: [string, string, string];
};

/** Well-known themes offered before any search; all checked to be published on Open VSX. */
const RECOMMENDED_THEMES: RecommendedTheme[] = [
  { id: 'Catppuccin.catppuccin-vsc', name: 'Catppuccin', colors: ['#1e1e2e', '#181825', '#cba6f7'] },
  { id: 'dracula-theme.theme-dracula', name: 'Dracula', colors: ['#282a36', '#21222c', '#bd93f9'] },
  { id: 'zhuangtongfa.material-theme', name: 'One Dark Pro', colors: ['#282c34', '#21252b', '#61afef'] },
  { id: 'GitHub.github-vscode-theme', name: 'GitHub Theme', colors: ['#ffffff', '#f6f8fa', '#0969da'] },
  { id: 'enkia.tokyo-night', name: 'Tokyo Night', colors: ['#1a1b26', '#16161e', '#7aa2f7'] },
  { id: 'arcticicestudio.nord-visual-studio-code', name: 'Nord', colors: ['#2e3440', '#3b4252', '#88c0d0'] },
  { id: 'jdinhlife.gruvbox', name: 'Gruvbox', colors: ['#282828', '#3c3836', '#fabd2f'] },
  { id: 'sdras.night-owl', name: 'Night Owl', colors: ['#011627', '#0b2942', '#82aaff'] },
];

/** What the browse tab shows before anything is typed: the curated list or an Open VSX ranking. */
type BrowseView = 'recommended' | 'downloadCount' | 'timestamp';

const BROWSE_VIEWS: BrowseView[] = ['recommended', 'downloadCount', 'timestamp'];

const SORTS: ThemeSearchSort[] = ['relevance', 'downloadCount', 'rating', 'timestamp'];

const JSON_PLACEHOLDER = `{
  "name": "My Theme",
  "type": "dark",
  "colors": { "editor.background": "#1e1e2e", ... }
}`;

/** Where an extension stands relative to what is installed, which picks its button. */
type InstallStatus = 'install' | 'update' | 'installed';

type AddThemeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Rendered by ColorThemeSection: adds themes from Open VSX, a Marketplace link, files or pasted JSON. */
export default function AddThemeDialog({ open, onOpenChange }: AddThemeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Settings is itself a modal at z-[9999]; this opens above it, and the
        // escape-layer marker keeps Escape from closing Settings underneath.
        data-escape-layer
        wrapperClassName="z-[10000]"
        aria-describedby="add-theme-description"
        className="flex max-h-[min(90vh,52rem)] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden p-0"
      >
        {/* DialogContent renders nothing while closed, so the panel and its
            state are rebuilt on every open and each visit starts clean. */}
        <AddThemePanel onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddThemePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('settings');
  const { activeSlot, availableThemes, installImportedThemes, setSlotTheme } = useTheme();

  const [tab, setTab] = useState<'browse' | 'import'>('browse');
  // What the user typed: a search, or a pasted extension link installed directly.
  const [query, setQuery] = useState('');
  const [browseView, setBrowseView] = useState<BrowseView>('recommended');
  // Only offered once there is a query; browsing has its own rankings.
  const [sort, setSort] = useState<ThemeSearchSort>('relevance');
  // The extension being downloaded, so only its card shows a spinner.
  const [installingId, setInstallingId] = useState<string | null>(null);
  // The one failure the user has to read to fix: a refused link, a broken file.
  const [error, setError] = useState<string | null>(null);
  const [jsonSource, setJsonSource] = useState('');
  // Highlights the drop zone while files are dragged over it.
  const [isDragging, setIsDragging] = useState(false);
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const searchText = query.trim();
  const pastedExtension = readExtensionUrl(query);
  const isQuerying = Boolean(searchText) && !pastedExtension;
  const isRanking = !searchText && browseView !== 'recommended';
  const search = useThemeSearch(
    isQuerying ? searchText : '',
    isQuerying ? sort : browseView === 'timestamp' ? 'timestamp' : 'downloadCount',
    tab === 'browse' && (isQuerying || isRanking),
  );

  const installedVersions = useMemo(() => {
    const versions = new Map<string, string | undefined>();
    for (const theme of availableThemes) {
      if (theme.source) {
        versions.set(theme.source.extensionId.toLowerCase(), theme.source.version);
      }
    }
    return versions;
  }, [availableThemes]);

  /** With no known latest version, an installed extension counts as up to date. */
  const statusOf = (extensionId: string, latestVersion?: string): InstallStatus => {
    const key = extensionId.toLowerCase();
    if (!installedVersions.has(key)) {
      return 'install';
    }
    return !latestVersion || installedVersions.get(key) === latestVersion ? 'installed' : 'update';
  };

  const reportFailure = (failure: unknown) => {
    setError(failure instanceof VsCodeThemeImportError ? failure.message : t('appearanceSettings.colorTheme.importFailed'));
  };

  // A first install puts the new theme on screen: in the slot showing if one of
  // its variants fits there, otherwise in the slot its first variant fits. An
  // update leaves both slots alone.
  const register = (themes: ColorTheme[], source?: ThemeSource) => {
    // A .vsix names itself in its manifest; what the caller knows wins over it.
    const effectiveSource = themes[0]?.source || source ? { ...themes[0]?.source, ...source } as ThemeSource : undefined;
    const isUpdate = effectiveSource ? installedVersions.has(effectiveSource.extensionId.toLowerCase()) : false;
    const ids = installImportedThemes(themes, effectiveSource);
    if (!isUpdate && themes.length > 0) {
      const fitting = themes.findIndex((theme) => isThemeAllowedInSlot(theme, activeSlot));
      const index = fitting === -1 ? 0 : fitting;
      setSlotTheme(fitting === -1 ? (themes[0].appearance === 'dark' ? 'dark' : 'light') : activeSlot, ids[index]);
    }
    setError(null);
  };

  const installExtension = async (url: string, source: ThemeSource, fallbackName: string) => {
    if (installingId) {
      return;
    }
    setInstallingId(source.extensionId);
    setError(null);
    try {
      // Proxied: the Marketplace sends no CORS headers, and both registries
      // answer an extension page with HTML rather than the archive.
      const response = await api.themes.downloadExtension(url);
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new VsCodeThemeImportError(readApiErrorMessage(body) ?? t('appearanceSettings.colorTheme.importFailed'));
      }
      register(await parseVsixThemes(await response.arrayBuffer(), fallbackName), source);
    } catch (failure) {
      reportFailure(failure);
    } finally {
      setInstallingId(null);
    }
  };

  const installPastedExtension = () => {
    if (pastedExtension) {
      void installExtension(
        pastedExtension.url,
        { extensionId: pastedExtension.extensionId },
        pastedExtension.extensionId.slice(pastedExtension.extensionId.indexOf('.') + 1),
      );
    }
  };

  // Files that read cleanly are kept even when another in the same drop fails.
  const importFiles = async (files: File[]) => {
    if (files.length === 0 || isImportingFiles) {
      return;
    }
    setIsImportingFiles(true);
    let failure: unknown = null;
    for (const file of files) {
      try {
        // One file at a time: each .vsix is its own extension to group and update.
        register(await importThemesFromFile(file));
      } catch (fileFailure) {
        failure = fileFailure;
      }
    }
    setIsImportingFiles(false);

    if (failure) {
      reportFailure(failure);
    } else {
      onClose();
    }
  };

  const addPastedJson = () => {
    try {
      register([parseVsCodeTheme(jsonSource)]);
      onClose();
    } catch (failure) {
      reportFailure(failure);
    }
  };

  const renderResults = (results: ThemeSearchResult[] | null) => {
    if (search.isSearching && !results?.length) {
      return (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-[5.5rem] animate-pulse rounded-lg border border-border bg-muted/40" />
          ))}
        </div>
      );
    }
    if (search.hasFailed) {
      return <p role="status" className="py-6 text-center text-sm text-muted-foreground">{t('appearanceSettings.colorTheme.add.search.failed')}</p>;
    }
    if (!results?.length) {
      return (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          {t('appearanceSettings.colorTheme.add.search.empty', { query: searchText })}
        </p>
      );
    }
    return (
      <ul className={cn('space-y-2 transition-opacity', search.isSearching && 'opacity-60')} aria-busy={search.isSearching}>
        {results.map((result) => (
          <SearchResultCard
            key={result.id}
            result={result}
            status={statusOf(result.id, result.version)}
            isInstalling={installingId === result.id}
            isBlocked={Boolean(installingId)}
            onInstall={() => void installExtension(
              result.url,
              { extensionId: result.id, version: result.version, displayName: result.displayName },
              result.displayName,
            )}
          />
        ))}
      </ul>
    );
  };

  return (
    <>
      <div className="flex-shrink-0 space-y-4 px-5 pb-4 pt-5 sm:px-6">
        <div className="pr-10">
          <DialogTitle className="not-sr-only text-base font-semibold text-foreground">
            {t('appearanceSettings.colorTheme.add.title')}
          </DialogTitle>
          <p id="add-theme-description" className="mt-1 text-sm text-muted-foreground">
            {t('appearanceSettings.colorTheme.add.description')}
          </p>
        </div>

        <PillBar role="tablist">
          <Pill role="tab" aria-selected={tab === 'browse'} isActive={tab === 'browse'} onClick={() => setTab('browse')}>
            <Search className="h-3.5 w-3.5" />
            {t('appearanceSettings.colorTheme.add.tabs.browse')}
          </Pill>
          <Pill role="tab" aria-selected={tab === 'import'} isActive={tab === 'import'} onClick={() => setTab('import')}>
            <Upload className="h-3.5 w-3.5" />
            {t('appearanceSettings.colorTheme.add.tabs.import')}
          </Pill>
        </PillBar>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-5 py-4 sm:px-6">
        {tab === 'browse' ? (
          <div className="space-y-4">
            {/* The plugins tab's install bar: one field for a search or a link. */}
            <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card focus-within:border-primary/40">
              <span className="flex-shrink-0 pl-3 pr-1 text-muted-foreground/50">
                {pastedExtension ? <GitBranch className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
              </span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && pastedExtension) {
                    installPastedExtension();
                  }
                }}
                placeholder={t('appearanceSettings.colorTheme.add.search.placeholder')}
                aria-label={t('appearanceSettings.colorTheme.add.search.placeholder')}
                className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
              {pastedExtension && (
                <button
                  type="button"
                  onClick={installPastedExtension}
                  disabled={Boolean(installingId)}
                  className="flex flex-shrink-0 items-center gap-1.5 border-l border-border bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {installingId === pastedExtension.extensionId
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Download className="h-3.5 w-3.5" />}
                  {t(`appearanceSettings.colorTheme.add.search.${statusOf(pastedExtension.extensionId) === 'installed' ? 'update' : 'install'}`)}
                </button>
              )}
            </div>

            {pastedExtension && (
              <p className="-mt-2 text-xs text-muted-foreground">
                {t('appearanceSettings.colorTheme.add.search.fromUrl', { id: pastedExtension.extensionId })}
              </p>
            )}

            {error && <p role="alert" className="-mt-2 text-sm text-red-500">{error}</p>}

            {!searchText && (
              <>
                <PillBar>
                  {BROWSE_VIEWS.map((view) => (
                    <Pill key={view} isActive={browseView === view} onClick={() => setBrowseView(view)} className="px-2.5 py-1.5 text-xs">
                      {t(`appearanceSettings.colorTheme.add.browse.${view}`)}
                    </Pill>
                  ))}
                </PillBar>

                {browseView === 'recommended' ? (
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {RECOMMENDED_THEMES.map((theme) => (
                      <RecommendationCard
                        key={theme.id}
                        theme={theme}
                        status={statusOf(theme.id)}
                        isInstalling={installingId === theme.id}
                        isBlocked={Boolean(installingId)}
                        onInstall={() => {
                          const [namespace, name] = theme.id.split('.');
                          void installExtension(
                            `https://open-vsx.org/extension/${namespace}/${name}`,
                            { extensionId: theme.id, displayName: theme.name },
                            theme.name,
                          );
                        }}
                      />
                    ))}
                  </ul>
                ) : renderResults(search.results)}
              </>
            )}

            {isQuerying && (
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('appearanceSettings.colorTheme.add.search.results')}
                  </h4>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t('appearanceSettings.colorTheme.add.search.sort.label')}
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value as ThemeSearchSort)}
                      className="touch-manipulation rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {SORTS.map((option) => (
                        <option key={option} value={option}>
                          {t(`appearanceSettings.colorTheme.add.search.sort.${option}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {renderResults(search.results)}
              </section>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                void importFiles(Array.from(event.dataTransfer.files));
              }}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
                isDragging ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <Upload className="h-5 w-5 text-muted-foreground/60" />
              <div className="text-sm font-medium text-foreground">{t('appearanceSettings.colorTheme.add.file.label')}</div>
              <div className="text-xs text-muted-foreground">{t('appearanceSettings.colorTheme.add.file.description')}</div>
              <button
                type="button"
                disabled={isImportingFiles}
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {isImportingFiles ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {t('appearanceSettings.colorTheme.add.file.button')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/json,.json,.vsix"
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  // Cleared straight away so picking the same file twice still fires a change.
                  event.target.value = '';
                  void importFiles(files);
                }}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="add-theme-json" className="block">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <FileJson className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('appearanceSettings.colorTheme.add.json.label')}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t('appearanceSettings.colorTheme.add.json.description')}</span>
              </label>
              <textarea
                id="add-theme-json"
                value={jsonSource}
                onChange={(event) => setJsonSource(event.target.value)}
                placeholder={JSON_PLACEHOLDER}
                rows={6}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!jsonSource.trim()}
                  onClick={addPastedJson}
                  className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  {t('appearanceSettings.colorTheme.add.submit')}
                </button>
              </div>
            </div>

            {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          </div>
        )}
      </div>

      <p className="flex flex-shrink-0 items-start gap-1.5 border-t border-border px-5 py-3 text-xs leading-snug text-muted-foreground/60 sm:px-6">
        <Globe className="mt-px h-3 w-3 flex-shrink-0" />
        <span>{t('appearanceSettings.colorTheme.add.notice')}</span>
      </p>

      {/* Last in the DOM so it is the last stop in the tab order. */}
      <button
        type="button"
        onClick={() => onClose()}
        aria-label={t('appearanceSettings.colorTheme.add.close')}
        className="absolute right-4 top-4 touch-manipulation rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </button>
    </>
  );
}

/**
 * The extension a pasted Marketplace or Open VSX page link names, or null for
 * anything else; such a link is installed directly rather than searched for.
 */
function readExtensionUrl(text: string): { extensionId: string; url: string } | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') {
    return null;
  }

  if (url.hostname === 'marketplace.visualstudio.com') {
    const itemName = url.searchParams.get('itemName') ?? '';
    return itemName.indexOf('.') > 0 ? { extensionId: itemName, url: url.toString() } : null;
  }
  if (url.hostname === 'open-vsx.org') {
    const [prefix, namespace, name] = url.pathname.split('/').filter(Boolean);
    return prefix === 'extension' && namespace && name
      ? { extensionId: `${namespace}.${name}`, url: url.toString() }
      : null;
  }
  return null;
}

type InstallActionProps = {
  status: InstallStatus;
  isInstalling: boolean;
  /** Another extension is downloading; one install at a time keeps the slots predictable. */
  isBlocked: boolean;
  onInstall: () => void;
};

/** The plugins tab's install button, which reads as a status once the extension is installed. */
function InstallAction({ status, isInstalling, isBlocked, onInstall }: InstallActionProps) {
  const { t } = useTranslation('settings');

  if (status === 'installed') {
    return (
      <span className="flex flex-shrink-0 items-center gap-1 px-2 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <Check className="h-3.5 w-3.5" />
        {t('appearanceSettings.colorTheme.add.search.installed')}
      </span>
    );
  }

  const Icon = isInstalling ? Loader2 : status === 'update' ? RefreshCw : Download;
  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={isBlocked}
      className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      <Icon className={cn('h-3.5 w-3.5', isInstalling && 'animate-spin')} />
      {isInstalling
        ? t('appearanceSettings.colorTheme.add.search.installing')
        : t(`appearanceSettings.colorTheme.add.search.${status}`)}
    </button>
  );
}

function RecommendationCard({ theme, ...install }: { theme: RecommendedTheme } & InstallActionProps) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors',
        install.status === 'installed' ? 'border-border' : 'border-dashed border-border hover:border-primary/50',
      )}
    >
      <span className="flex flex-shrink-0 items-center -space-x-1.5">
        {theme.colors.map((color, index) => (
          <span key={color + String(index)} className="h-5 w-5 rounded-full border border-border/60" style={{ backgroundColor: color }} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{theme.name}</span>
        <span className="block truncate text-xs text-muted-foreground/70">{theme.id.slice(0, theme.id.indexOf('.'))}</span>
      </span>
      <InstallAction {...install} />
    </li>
  );
}

function SearchResultCard({ result, ...install }: { result: ThemeSearchResult } & InstallActionProps) {
  const { t, i18n } = useTranslation('settings');
  const downloads = useMemo(
    () => new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 }).format(result.downloadCount),
    [i18n.language, result.downloadCount],
  );
  const sourceHost = result.sourceUrl ? new URL(result.sourceUrl).hostname : null;
  const SourceIcon = sourceHost === 'github.com' ? Github : GitBranch;

  return (
    <li className="relative flex overflow-hidden rounded-lg border border-border bg-card">
      {/* Left accent bar, as on plugin cards: green once installed. */}
      <div className={cn('w-[3px] flex-shrink-0', install.status === 'install' ? 'bg-muted-foreground/20' : 'bg-emerald-500')} />
      <div className="flex min-w-0 flex-1 items-start gap-3 p-3">
        <ExtensionIcon url={result.iconUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold leading-none text-foreground">{result.displayName}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">v{result.version}</span>
          </div>
          {result.description && (
            <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">{result.description}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground/60">
            <span>{result.namespace}</span>
            <span>{t('appearanceSettings.colorTheme.add.search.downloads', { value: downloads })}</span>
            {result.sourceUrl && (
              <a
                href={result.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t('appearanceSettings.colorTheme.add.search.source')}: ${result.displayName}`}
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <SourceIcon className="h-3 w-3" />
                <span className="max-w-[180px] truncate">{new URL(result.sourceUrl).pathname.replace(/^\//, '')}</span>
              </a>
            )}
          </div>
        </div>
        <InstallAction {...install} />
      </div>
    </li>
  );
}

function ExtensionIcon({ url }: { url: string | null }) {
  // A registry icon that fails to load falls back to the generic glyph rather
  // than leaving a broken-image box in the card.
  const [hasFailed, setHasFailed] = useState(false);

  if (!url || hasFailed) {
    return (
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Package className="h-4 w-4" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setHasFailed(true)}
      className="h-9 w-9 flex-shrink-0 rounded-md object-contain"
    />
  );
}
