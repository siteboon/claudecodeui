import { Volume2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { SETTING_ROW_CLASS } from '@/shared/constants';
import { useSetUiPreference, useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { VOICE_NS } from '@/modules/chat/voice/voiceI18n';
import { useVoiceStatus } from '@/modules/chat/voice/voiceState';

/**
 * The `autoSpeak` preference (KTD8): off by default, and disabled with a plain
 * explanation while voice is off or not set up in this workspace - never hidden
 * in the Settings tab, so the builder learns why it cannot be switched on.
 *
 * `quick` is the Quick Settings row, rendered only while voice is on (the same
 * rule upstream applies to its own voice row there).
 */
export default function AutoSpeakSetting({ variant }: { variant: 'quick' | 'settings' }) {
  const { t } = useTranslation(VOICE_NS);
  const { autoSpeak, voiceEnabled } = useUiPreferences();
  const setPreference = useSetUiPreference();
  const status = useVoiceStatus();
  const hintId = useId();

  const available = status === 'available';
  const checked = autoSpeak && available;
  const hint = available ? t('autoSpeak.description') : t('autoSpeak.unavailable');

  if (variant === 'quick') {
    if (!voiceEnabled) return null;
    return (
      <div className="space-y-1">
        <label className={`${SETTING_ROW_CLASS} ${available ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            <Volume2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t('autoSpeak.label')}
          </span>
          <input
            type="checkbox"
            checked={checked}
            disabled={!available}
            aria-describedby={hintId}
            onChange={(event) => setPreference('autoSpeak', event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <p id={hintId} className="ml-3 text-xs text-muted-foreground">{hint}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-3">
      <div className="pr-3">
        <div className="text-sm font-medium text-foreground">{t('autoSpeak.label')}</div>
        <div id={hintId} className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {/* Same look as the settings module's switch, which this module may not import. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={t('autoSpeak.label')}
        aria-describedby={hintId}
        disabled={!available}
        onClick={() => setPreference('autoSpeak', !checked)}
        className={`relative inline-flex h-7 w-12 flex-shrink-0 touch-manipulation cursor-pointer items-center rounded-full border-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${checked ? 'border-primary bg-primary' : 'border-border bg-muted'} ${available ? '' : 'cursor-not-allowed opacity-50'}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-200 ${checked ? 'translate-x-[22px] bg-white' : 'translate-x-[2px] bg-foreground/60 dark:bg-foreground/80'}`}
        />
      </button>
    </div>
  );
}
