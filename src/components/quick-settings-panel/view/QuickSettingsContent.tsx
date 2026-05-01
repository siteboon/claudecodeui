import { Layers, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DarkModeToggle } from '../../../shared/view/ui';
import LanguageSelector from '../../../shared/view/ui/LanguageSelector';
import { useToolDisplay } from '../../../contexts/ToolDisplayContext';
import type { ToolDisplayDensity } from '../../../hooks/useToolDisplayPreferences';
import {
  INPUT_SETTING_TOGGLES,
  SETTING_ROW_CLASS,
  TOOL_DISPLAY_TOGGLES,
  VIEW_OPTION_TOGGLES,
} from '../constants';
import type {
  PreferenceToggleItem,
  PreferenceToggleKey,
  QuickSettingsPreferences,
} from '../types';
import QuickSettingsSection from './QuickSettingsSection';
import QuickSettingsToggleRow from './QuickSettingsToggleRow';

type QuickSettingsContentProps = {
  isDarkMode: boolean;
  preferences: QuickSettingsPreferences;
  onPreferenceChange: (key: PreferenceToggleKey, value: boolean) => void;
};

export default function QuickSettingsContent({
  isDarkMode,
  preferences,
  onPreferenceChange,
}: QuickSettingsContentProps) {
  const { t } = useTranslation('settings');
  const { preferences: toolDisplayPrefs, setGlobalDensity } = useToolDisplay();

  const densityOptions: { value: ToolDisplayDensity; label: string }[] = [
    { value: 'compact', label: t('quickSettings.density.compact', 'Compact') },
    { value: 'standard', label: t('quickSettings.density.standard', 'Standard') },
    { value: 'expanded', label: t('quickSettings.density.expanded', 'Expanded') },
  ];

  const renderToggleRows = (items: PreferenceToggleItem[]) => (
    items.map(({ key, labelKey, icon }) => (
      <QuickSettingsToggleRow
        key={key}
        label={t(labelKey)}
        icon={icon}
        checked={preferences[key]}
        onCheckedChange={(value) => onPreferenceChange(key, value)}
      />
    ))
  );

  return (
    <div className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden bg-background p-4">
      <QuickSettingsSection title={t('quickSettings.sections.appearance')}>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            {isDarkMode ? (
              <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            ) : (
              <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            )}
            {t('quickSettings.darkMode')}
          </span>
          <DarkModeToggle />
        </div>
        <LanguageSelector compact />
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.toolDisplay')}>
        {/* Tool display density selector */}
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <Layers className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            {t('quickSettings.density.label', 'Display Density')}
          </span>
          <div className="flex rounded-md border border-border">
            {densityOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setGlobalDensity(value)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
                  toolDisplayPrefs.globalDensity === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {renderToggleRows(TOOL_DISPLAY_TOGGLES)}
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.viewOptions')}>
        {renderToggleRows(VIEW_OPTION_TOGGLES)}
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.inputSettings')}>
        {renderToggleRows(INPUT_SETTING_TOGGLES)}
        <p className="ml-3 text-xs text-gray-500 dark:text-gray-400">
          {t('quickSettings.sendByCtrlEnterDescription')}
        </p>
      </QuickSettingsSection>
    </div>
  );
}
