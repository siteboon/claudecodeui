import { Check, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { VsCodeThemeImportError, parseVsCodeTheme } from '@/shared/themes';
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

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared straight away so picking the same file twice still fires a change.
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      const source = await file.text();
      // A theme shipped in an extension names itself in package.json, not in the
      // colour file, so the file name is the best fallback available here.
      const fallbackName = file.name.replace(/(-color-theme)?\.json$/i, '');
      const theme = parseVsCodeTheme(source, fallbackName);
      addImportedTheme(theme);
      setColorTheme(theme.id);
      setImportError(null);
    } catch (error) {
      setImportError(
        error instanceof VsCodeThemeImportError ? error.message : t('appearanceSettings.colorTheme.importFailed'),
      );
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
              accept="application/json,.json"
              className="hidden"
              onChange={handleFileSelected}
            />
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
