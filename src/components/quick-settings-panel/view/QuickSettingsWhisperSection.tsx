import { useTranslation } from 'react-i18next';
import { TOGGLE_ROW_CLASS, WHISPER_OPTIONS } from '../constants';
import { useWhisperMode } from '../hooks/useWhisperMode';
import QuickSettingsSection from './QuickSettingsSection';

export default function QuickSettingsWhisperSection() {
  const { t } = useTranslation('settings');
  const { setWhisperMode, isOptionSelected } = useWhisperMode();

  return (
    // This section stays hidden intentionally until dictation modes are reintroduced.
    <QuickSettingsSection
      title={t('quickSettings.sections.whisperDictation')}
      className="hidden"
    >
      <div className="space-y-2">
        {WHISPER_OPTIONS.map(({ value, icon: Icon, titleKey, descriptionKey }) => (
          <label
            key={value}
            className={`${TOGGLE_ROW_CLASS} flex items-start`}
          >
            <input
              type="radio"
              name="whisperMode"
              value={value}
              checked={isOptionSelected(value)}
              onChange={() => setWhisperMode(value)}
              className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-blue-500 dark:checked:bg-blue-600 dark:focus:ring-blue-400"
            />
            <div className="ml-3 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                <Icon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                {t(titleKey)}
              </span>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t(descriptionKey)}
              </p>
            </div>
          </label>
        ))}
      </div>
    </QuickSettingsSection>
  );
}
