import { Play } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import { VOICE_NS } from '@/modules/chat/voice/voiceI18n';
import { messageKeyOf, useVoiceNote } from '@/modules/chat/voice/voiceUiStore';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';

const subscribePlayer = (listener: () => void) => voicePlayer.subscribe(listener);

/**
 * Attached to the assistant reply that ended a spoken turn, so it survives a
 * session switch: "bez hlasového shrnutí" when the reply had no valid spoken
 * line, and "Přehrát odpověď" when the browser refused to play it by itself -
 * the replay uses the audio already fetched, never a second request. Shown only
 * while auto-speak is on; the note lives until the next turn in that session.
 */
export default function MessageVoiceNote({ content }: { content: string }) {
  const { t } = useTranslation(VOICE_NS);
  const { autoSpeak, voiceEnabled } = useUiPreferences();
  const note = useVoiceNote(messageKeyOf(content));
  const blocked = useSyncExternalStore(
    subscribePlayer,
    () => (note?.kind === 'spoken' ? voicePlayer.isBlocked(note.voiceId) : false),
    () => false,
  );

  if (!autoSpeak || !voiceEnabled || !note) return null;

  if (note.kind === 'no_summary') {
    return <span className="italic text-muted-foreground">{t('playback.noSummary')}</span>;
  }

  if (!blocked) return null;

  return (
    <button
      type="button"
      onClick={() => {
        voicePlayer.unlock();
        voicePlayer.replay(note.voiceId);
      }}
      title={note.line}
      aria-label={`${t('playback.replay')}: ${note.line}`}
      className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Play className="h-3 w-3" aria-hidden="true" />
      {t('playback.replay')}
    </button>
  );
}
