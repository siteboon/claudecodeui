import { Check, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { isThemeAllowedInSlot } from '@/shared/themes';
import type { ColorTheme, ThemeMode, ThemeSlot } from '@/shared/types';
import { cn } from '@/shared/utils';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import AddThemeDialog from '@/modules/settings/tabs/appearance-settings/AddThemeDialog';

/** The group the built-in palettes are listed under; a product name, so never translated. */
const BUILT_IN_GROUP_NAME = 'CloudCLI';

const SLOTS: ThemeSlot[] = ['light', 'dark'];

/** The themes one extension (or one loose file) brought, listed and removed together. */
type ThemeGroup = {
  key: string;
  name: string;
  version?: string;
  isBuiltIn: boolean;
  themes: ColorTheme[];
};

/** Rendered by the appearance tab: picks light/dark/system, the palette for each mode, and opens the add-theme dialog. */
export default function ColorThemeSection() {
  const { t } = useTranslation('settings');
  const { themeMode, setThemeMode, activeSlot, slotThemes, setSlotTheme, availableThemes, removeImportedThemes } = useTheme();
  // The slot the list below fills; starts on the one on screen so a click shows at once.
  const [editedSlot, setEditedSlot] = useState<ThemeSlot>(activeSlot);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  // The group whose remove button was pressed once; a second press removes it, as in Plugins.
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);

  const groups = useMemo(() => groupThemes(availableThemes), [availableThemes]);
  const themesById = useMemo(() => new Map(availableThemes.map((theme) => [theme.id, theme])), [availableThemes]);

  const fittingGroups = groups
    .map((group) => ({ ...group, themes: group.themes.filter((theme) => isThemeAllowedInSlot(theme, editedSlot)) }))
    .filter((group) => group.themes.length > 0);
  const otherModeGroups = groups.filter((group) => !fittingGroups.some((fitting) => fitting.key === group.key));

  return (
    <SettingsSection
      title={t('appearanceSettings.theme.label')}
      description={t('appearanceSettings.colorTheme.description')}
    >
      <SettingsCard className="p-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">{t('appearanceSettings.theme.description')}</span>
          <select
            value={themeMode}
            onChange={(event) => {
              const mode = event.target.value as ThemeMode;
              setThemeMode(mode);
              // Choosing a mode shows its slot, so edit that one.
              if (mode !== 'system') {
                setEditedSlot(mode);
              }
            }}
            aria-label={t('appearanceSettings.theme.label')}
            className="w-full flex-shrink-0 touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-56"
          >
            <option value="light">{t('appearanceSettings.theme.light')}</option>
            <option value="dark">{t('appearanceSettings.theme.dark')}</option>
            <option value="system">{t('appearanceSettings.theme.system')}</option>
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SLOTS.map((slot) => {
            const theme = themesById.get(slotThemes[slot]);
            return theme ? (
              <SlotCard
                key={slot}
                slot={slot}
                theme={theme}
                groupName={groups.find((group) => group.themes.includes(theme))?.name ?? ''}
                isActive={activeSlot === slot}
                isEdited={editedSlot === slot}
                onEdit={() => setEditedSlot(slot)}
              />
            ) : null;
          })}
        </div>

        <div className="mt-5 space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`appearanceSettings.colorTheme.list.${editedSlot}Title`)}
          </h4>

          {fittingGroups.map((group) => (
            <ThemeGroupCard
              key={group.key}
              group={group}
              slot={editedSlot}
              selectedId={slotThemes[editedSlot]}
              onSelect={(themeId) => setSlotTheme(editedSlot, themeId)}
              isConfirmingRemoval={confirmingRemoval === group.key}
              onRemove={group.isBuiltIn ? undefined : () => {
                if (confirmingRemoval !== group.key) {
                  setConfirmingRemoval(group.key);
                  return;
                }
                // Every variant goes, including those only offered in the other slot.
                const allThemes = groups.find((candidate) => candidate.key === group.key)?.themes ?? group.themes;
                removeImportedThemes(allThemes.map((theme) => theme.id));
                setConfirmingRemoval(null);
              }}
              onCancelRemoval={() => setConfirmingRemoval(null)}
            />
          ))}

          {otherModeGroups.length > 0 && (
            <p className="px-1 text-xs text-muted-foreground/70">
              {t(`appearanceSettings.colorTheme.list.${editedSlot === 'light' ? 'darkOnly' : 'lightOnly'}`, {
                names: otherModeGroups.map((group) => group.name).join(', '),
              })}
            </p>
          )}

          <button
            type="button"
            onClick={() => setIsAddDialogOpen(true)}
            className="flex w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" />
            {t('appearanceSettings.colorTheme.add.button')}
          </button>
        </div>
      </SettingsCard>

      <AddThemeDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
    </SettingsSection>
  );
}

/**
 * Groups themes by the extension they came from, in the order first seen; the
 * built-in ones form their own group and a theme from a loose file stands alone.
 */
function groupThemes(themes: ColorTheme[]): ThemeGroup[] {
  const groups = new Map<string, ThemeGroup>();
  for (const theme of themes) {
    const key = !theme.tokens ? 'built-in' : theme.source ? theme.source.extensionId.toLowerCase() : `file:${theme.id}`;
    const group = groups.get(key) ?? {
      key,
      name: !theme.tokens ? BUILT_IN_GROUP_NAME : theme.source ? theme.source.displayName ?? theme.source.extensionId : theme.name,
      version: theme.source?.version,
      isBuiltIn: !theme.tokens,
      themes: [],
    };
    group.themes.push(theme);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The swatches for a theme in a slot: a `system` theme shows its dark variant in the dark slot. */
function previewColorsFor(theme: ColorTheme, slot: ThemeSlot): [string, string, string] {
  return slot === 'dark' && theme.darkPreviewColors ? theme.darkPreviewColors : theme.previewColors;
}

type SlotCardProps = {
  slot: ThemeSlot;
  theme: ColorTheme;
  groupName: string;
  isActive: boolean;
  isEdited: boolean;
  onEdit: () => void;
};

function SlotCard({ slot, theme, groupName, isActive, isEdited, onEdit }: SlotCardProps) {
  const { t } = useTranslation('settings');
  const SlotIcon = slot === 'light' ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-pressed={isEdited}
      className={cn(
        'flex touch-manipulation flex-col gap-3 rounded-lg border bg-card p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isEdited ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-muted-foreground/40',
      )}
    >
      <span className="flex items-center gap-2">
        <SlotIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">{t(`appearanceSettings.colorTheme.slots.${slot}`)}</span>
        {isActive && (
          <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            {t('appearanceSettings.colorTheme.slots.active')}
          </span>
        )}
      </span>
      <ThemePreview colors={previewColorsFor(theme, slot)} slot={slot} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{theme.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{groupName}</span>
      </span>
    </button>
  );
}

/**
 * A miniature of the app in a theme's colours: background, a sidebar on the
 * surface colour and accent touches. Inline styles, because a theme's colours
 * are data and an imported palette has no class to name.
 */
function ThemePreview({ colors, slot }: { colors: [string, string, string]; slot: ThemeSlot }) {
  const [background, surface, accent] = colors;
  // Text stand-ins: the swatches carry no foreground, and the slot says which way contrast runs.
  const line = slot === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.14)';

  return (
    <span
      aria-hidden
      className="flex h-20 overflow-hidden rounded-md border border-border/60"
      style={{ backgroundColor: background }}
    >
      <span className="flex w-1/4 flex-col gap-1.5 p-2" style={{ backgroundColor: surface }}>
        <span className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: accent }} />
        <span className="h-1.5 w-full rounded-full" style={{ backgroundColor: line }} />
        <span className="h-1.5 w-2/3 rounded-full" style={{ backgroundColor: line }} />
      </span>
      <span className="flex flex-1 flex-col justify-between p-2">
        <span className="space-y-1.5">
          <span className="block h-1.5 w-2/3 rounded-full" style={{ backgroundColor: line }} />
          <span className="block h-1.5 w-1/2 rounded-full" style={{ backgroundColor: line }} />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 flex-1 rounded" style={{ backgroundColor: surface, boxShadow: `inset 0 0 0 1px ${line}` }} />
          <span className="h-3 w-3 rounded" style={{ backgroundColor: accent }} />
        </span>
      </span>
    </span>
  );
}

type ThemeGroupCardProps = {
  group: ThemeGroup;
  slot: ThemeSlot;
  selectedId: string;
  onSelect: (themeId: string) => void;
  /** Unset for the built-in group, which cannot be removed. */
  onRemove?: () => void;
  isConfirmingRemoval: boolean;
  onCancelRemoval: () => void;
};

function ThemeGroupCard({ group, slot, selectedId, onSelect, onRemove, isConfirmingRemoval, onCancelRemoval }: ThemeGroupCardProps) {
  const { t } = useTranslation('settings');
  const holdsSelection = group.themes.some((theme) => theme.id === selectedId);

  return (
    <div className="relative flex overflow-hidden rounded-lg border border-border bg-card">
      {/* Left accent bar, as on plugin cards: lit on the group the slot uses. */}
      <div className={cn('w-[3px] flex-shrink-0 transition-colors', holdsSelection ? 'bg-primary' : 'bg-muted-foreground/20')} />

      <div className="min-w-0 flex-1 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{group.name}</span>
            {group.version && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">v{group.version}</span>
            )}
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`${t('appearanceSettings.colorTheme.remove')}: ${group.name}`}
              title={t('appearanceSettings.colorTheme.remove')}
              className={cn(
                'flex-shrink-0 touch-manipulation rounded p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isConfirmingRemoval
                  ? 'bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30'
                  : 'text-muted-foreground hover:bg-muted hover:text-red-500',
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {group.themes.map((theme) => {
            const isSelected = theme.id === selectedId;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onSelect(theme.id)}
                aria-pressed={isSelected}
                className={cn(
                  'flex touch-manipulation items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span className="flex items-center -space-x-1">
                  {previewColorsFor(theme, slot).map((color, index) => (
                    <span
                      key={color + String(index)}
                      className="h-3.5 w-3.5 rounded-full border border-border/60"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                <span className="max-w-[12rem] truncate">{theme.name}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>

        {isConfirmingRemoval && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800/50 dark:bg-red-950/30">
            <span className="text-sm text-red-600 dark:text-red-400">
              {t('appearanceSettings.colorTheme.removeConfirm', { name: group.name })}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={onCancelRemoval}
                className="rounded border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t('appearanceSettings.colorTheme.removeCancel')}
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="rounded border border-red-300 px-2.5 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                {t('appearanceSettings.colorTheme.removeButton')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
