import { Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSelector from '../../../LanguageSelector';
import type { CodeEditorSettingsState, ProjectSortOrder } from '../../types/types';

type AppearanceSettingsTabProps = {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorThemeChange: (value: 'dark' | 'light') => void;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
};

type ToggleCardProps = {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  onIcon?: ReactNode;
  offIcon?: ReactNode;
  ariaLabel: string;
};

function ToggleCard({
  label,
  description,
  checked,
  onChange,
  onIcon,
  offIcon,
  ariaLabel,
}: ToggleCardProps) {
  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-foreground">{label}</div>
          <div className="text-sm text-muted-foreground">{description}</div>
        </div>
        <button
          onClick={() => onChange(!checked)}
          className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel}
        >
          <span className="sr-only">{ariaLabel}</span>
          <span
            className={`${
              checked ? 'translate-x-7' : 'translate-x-1'
            } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200 flex items-center justify-center`}
          >
            {checked ? onIcon : offIcon}
          </span>
        </button>
      </div>
    </div>
  );
}

export default function AppearanceSettingsTab({
  isDarkMode,
  onToggleDarkMode,
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorThemeChange,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="space-y-4">
        <ToggleCard
          label={t('appearanceSettings.darkMode.label')}
          description={t('appearanceSettings.darkMode.description')}
          checked={isDarkMode}
          onChange={onToggleDarkMode}
          onIcon={<Moon className="w-3.5 h-3.5 text-gray-700" />}
          offIcon={<Sun className="w-3.5 h-3.5 text-yellow-500" />}
          ariaLabel={t('appearanceSettings.darkMode.label')}
        />
      </div>

      <div className="space-y-4">
        <LanguageSelector />
      </div>

      <div className="space-y-4">
        <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">
                {t('appearanceSettings.projectSorting.label')}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('appearanceSettings.projectSorting.description')}
              </div>
            </div>
            <select
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 w-32"
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">{t('appearanceSettings.codeEditor.title')}</h3>

        <ToggleCard
          label={t('appearanceSettings.codeEditor.theme.label')}
          description={t('appearanceSettings.codeEditor.theme.description')}
          checked={codeEditorSettings.theme === 'dark'}
          onChange={(enabled) => onCodeEditorThemeChange(enabled ? 'dark' : 'light')}
          onIcon={<Moon className="w-3.5 h-3.5 text-gray-700" />}
          offIcon={<Sun className="w-3.5 h-3.5 text-yellow-500" />}
          ariaLabel={t('appearanceSettings.codeEditor.theme.label')}
        />

        <ToggleCard
          label={t('appearanceSettings.codeEditor.wordWrap.label')}
          description={t('appearanceSettings.codeEditor.wordWrap.description')}
          checked={codeEditorSettings.wordWrap}
          onChange={onCodeEditorWordWrapChange}
          ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
        />

        <ToggleCard
          label={t('appearanceSettings.codeEditor.showMinimap.label')}
          description={t('appearanceSettings.codeEditor.showMinimap.description')}
          checked={codeEditorSettings.showMinimap}
          onChange={onCodeEditorShowMinimapChange}
          ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
        />

        <ToggleCard
          label={t('appearanceSettings.codeEditor.lineNumbers.label')}
          description={t('appearanceSettings.codeEditor.lineNumbers.description')}
          checked={codeEditorSettings.lineNumbers}
          onChange={onCodeEditorLineNumbersChange}
          ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
        />

        <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">
                {t('appearanceSettings.codeEditor.fontSize.label')}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('appearanceSettings.codeEditor.fontSize.description')}
              </div>
            </div>
            <select
              value={codeEditorSettings.fontSize}
              onChange={(event) => onCodeEditorFontSizeChange(event.target.value)}
              className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 w-24"
            >
              <option value="10">10px</option>
              <option value="11">11px</option>
              <option value="12">12px</option>
              <option value="13">13px</option>
              <option value="14">14px</option>
              <option value="15">15px</option>
              <option value="16">16px</option>
              <option value="18">18px</option>
              <option value="20">20px</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
