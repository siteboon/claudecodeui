import { Loader2, Square, Volume2, VolumeX } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import { VOICE_NS } from '@/modules/chat/voice/voiceI18n';
import type { VoiceStatus } from '@/modules/chat/voice/voiceState';
import { useVoiceAnnouncement } from '@/modules/chat/voice/voiceUiStore';
import { useSetUiPreference, useUiPreferences } from '@/shared/context/UiPreferencesContext';

/** Announcements that also stay visible under the composer, not only in the live region. */
const VISIBLE_KEYS = new Set(['dictation.awaitingConfirmation', 'dictation.autoStopped', 'dictation.savedToOrigin']);

const subscribePlayer = (listener: () => void) => voicePlayer.subscribe(listener);
const playerState = () => voicePlayer.current().state;

/**
 * Beside the mic: the always-visible auto-speak state (a toggle), a stop
 * control while a reply is loading or playing, and the polite live region that
 * announces recording, loading, errors and "no voice summary". Rendered only
 * while upstream's voice toggle is on.
 */
export default function ComposerVoiceStatus({ status }: { status: VoiceStatus }) {
  const { t } = useTranslation(VOICE_NS);
  const { autoSpeak } = useUiPreferences();
  const setPreference = useSetUiPreference();
  const state = useSyncExternalStore(subscribePlayer, playerState, playerState);
  const announcement = useVoiceAnnouncement();

  const available = status === 'available';
  const on = autoSpeak && available;
  const stateLabel = on ? t('autoSpeak.stateOn') : t('autoSpeak.stateOff');
  const busy = state === 'loading' || state === 'playing';
  const liveText =
    state === 'loading'
      ? t('playback.loading')
      : announcement
        ? t(announcement.key, announcement.params as Record<string, string> | undefined)
        : '';

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-pressed={on}
        aria-label={stateLabel}
        title={available ? stateLabel : t('autoSpeak.unavailable')}
        disabled={!available}
        onClick={() => setPreference('autoSpeak', !autoSpeak)}
        className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {on ? <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> : <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />}
        <span className="hidden sm:inline">{on ? t('autoSpeak.shortOn') : t('autoSpeak.shortOff')}</span>
      </button>

      {busy && (
        <button
          type="button"
          onClick={() => voicePlayer.stop()}
          aria-label={t('playback.stop')}
          title={state === 'loading' ? t('playback.loading') : t('playback.stop')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {state === 'loading' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Square className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      )}

      {announcement && VISIBLE_KEYS.has(announcement.key) && (
        <span className="max-w-[16rem] truncate text-[11px] text-muted-foreground">{liveText}</span>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {liveText}
      </span>
    </span>
  );
}
