import { Check, Loader2, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { useTheme } from '@/shared/context/ThemeContext';
import { VsCodeThemeImportError, importThemesFromFile, parseVsixThemes } from '@/shared/themes';
import type { ColorTheme } from '@/shared/types';
import { cn } from '@/shared/utils';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';

/** Rendered by the appearance tab: picks the colour palette and imports VS Code themes. */
export default function ColorThemeSection() {
  const { t } = useTranslation('settings');
  const { colorTheme, setColorTheme, availableThemes, addImportedTheme, removeImportedTheme } = useTheme();

  const fileInputRef = useRef<HTMLInputElement>(null);
  // The one thing the user cannot fix without being told what went wrong: which
  // part of the file made it unusable as a theme.
  const [importError, setImportError] = useState<string | null>(null);
  // The URL being pasted, and whether its download is in flight — a marketplace
  // extension is a few hundred kilobytes, long enough to need a spinner.
  const [extensionUrl, setExtensionUrl] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  // One .vsix routinely contributes several themes — a flavour per variant — so
  // all of them are registered and the first is the one switched to.
  const registerThemes = (themes: ColorTheme[]) => {
    for (const theme of themes) {
      addImportedTheme(theme);
    }
    setColorTheme(themes[0].id);
    setImportError(null);
  };

  const reportFailure = (error: unknown) => {
    setImportError(
      error instanceof VsCodeThemeImportError ? error.message : t('appearanceSettings.colorTheme.importFailed'),
    );
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared straight away so picking the same file twice still fires a change.
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      registerThemes(await importThemesFromFile(file));
    } catch (error) {
      reportFailure(error);
    }
  };

  const handleUrlImport = async () => {
    const url = extensionUrl.trim();
    if (!url || isDownloading) {
      return;
    }

    setIsDownloading(true);
    try {
      // The download is proxied: the Marketplace sends no CORS headers, and both
      // registries answer an extension page with HTML rather than an archive.
      const response = await api.themes.downloadExtension(url);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new VsCodeThemeImportError(
          payload?.error?.message ?? t('appearanceSettings.colorTheme.importFailed'),
        );
      }

      registerThemes(await parseVsixThemes(await response.arrayBuffer(), extensionNameFromUrl(url)));
      setExtensionUrl('');
    } catch (error) {
      reportFailure(error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <SettingsSection
      title={t('appearanceSettings.colorTheme.label')}
      description={t('appearanceSettings.colorTheme.description')}
    >
      <SettingsCard className="p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {availableThemes.map((theme) => (
            <ThemeOption
              key={theme.id}
              theme={theme}
              isSelected={theme.id === colorTheme}
              onSelect={() => setColorTheme(theme.id)}
              onRemove={theme.tokens ? () => removeImportedTheme(theme.id) : undefined}
              removeLabel={t('appearanceSettings.colorTheme.remove')}
            />
          ))}
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {t('appearanceSettings.colorTheme.import.label')}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {t('appearanceSettings.colorTheme.import.description')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex flex-shrink-0 touch-manipulation items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <Upload className="h-4 w-4" />
              {t('appearanceSettings.colorTheme.import.button')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json,.vsix"
              className="hidden"
              onChange={handleFileSelected}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="url"
              inputMode="url"
              value={extensionUrl}
              onChange={(event) => setExtensionUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleUrlImport();
                }
              }}
              placeholder={t('appearanceSettings.colorTheme.import.urlPlaceholder')}
              aria-label={t('appearanceSettings.colorTheme.import.urlLabel')}
              className="min-w-0 flex-1 touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => void handleUrlImport()}
              disabled={!extensionUrl.trim() || isDownloading}
              className="inline-flex flex-shrink-0 touch-manipulation items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDownloading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('appearanceSettings.colorTheme.import.urlButton')}
            </button>
          </div>

          {importError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {importError}
            </p>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

/** Names an import after the extension the URL points at, for a theme file that carries no name of its own. */
function extensionNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const itemName = parsed.searchParams.get('itemName');
    if (itemName) {
      return itemName.slice(itemName.indexOf('.') + 1);
    }
    return parsed.pathname.split('/').filter(Boolean).at(-1) ?? 'Imported theme';
  } catch {
    return 'Imported theme';
  }
}

type ThemeOptionProps = {
  theme: ColorTheme;
  isSelected: boolean;
  onSelect: () => void;
  /** Only imported themes can be removed, so built-in ones leave this unset. */
  onRemove?: () => void;
  removeLabel: string;
};

function ThemeOption({ theme, isSelected, onSelect, onRemove, removeLabel }: ThemeOptionProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors',
        isSelected ? 'border-primary bg-accent/50' : 'border-border hover:bg-accent/30',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className="flex min-w-0 flex-1 touch-manipulation items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* The swatches are inline styles because a theme's colours are data, not
            classes — an imported palette has no stylesheet to name here. */}
        <span className="flex flex-shrink-0 items-center -space-x-1.5">
          {theme.previewColors.map((color, index) => (
            <span
              key={color + String(index)}
              className="h-5 w-5 rounded-full border border-border/60"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{theme.name}</span>
        {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${removeLabel}: ${theme.name}`}
          title={removeLabel}
          className="flex-shrink-0 touch-manipulation rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
