import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Mic, Square, Loader2, RotateCcw } from 'lucide-react';

import { PromptInputButton } from '@/modules/chat/composer/PromptInput';
import type { VoiceInputState } from '@/shared/types';
import { formatElapsed } from '@/modules/chat/voice/dictation';
import { VOICE_NS } from '@/modules/chat/voice/voiceI18n';

type Props = {
  state: VoiceInputState;
  onToggle: () => void;
  /** A translation key in the `voice` namespace. */
  errorMsg?: string | null;
  /** Voice is on but not set up here: the button stays, disabled, with the reason. */
  disabled?: boolean;
  /** When the running recording started (for the visible elapsed indicator). */
  startedAt?: number | null;
  /** The last clip failed to transcribe and is kept for one retry. */
  canRetry?: boolean;
  onRetry?: () => void;
};

function useElapsed(startedAt: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt ? now - startedAt : 0;
}

// Rendered by chat's ChatComposer next to the send button.
// Push-to-talk mic button (presentational). Recording state and the stop-and-send action
// are owned by the composer so the main Send button can drive them too. This button just
// starts recording and, while recording, stops and drops the transcript into the input box.
export default function VoiceInputButton({ state, onToggle, errorMsg, disabled, startedAt, canRetry, onRetry }: Props) {
  const { t } = useTranslation('chat');
  const { t: tVoice } = useTranslation(VOICE_NS);
  const elapsed = useElapsed(state === 'recording' ? startedAt : null);
  const label = disabled
    ? tVoice('dictation.unavailable')
    : state === 'recording'
      ? t('voice.stopRecording')
      : state === 'transcribing'
        ? tVoice('dictation.transcribing')
        : t('voice.input');

  const icon =
    state === 'recording' ? (
      <Square className="text-red-500" />
    ) : state === 'transcribing' ? (
      <Loader2 className="animate-spin" />
    ) : (
      <Mic />
    );

  return (
    <span className="relative inline-flex">
      {errorMsg && (
        <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-red-600 px-2 py-1 text-xs text-white shadow-lg">
          {tVoice(errorMsg)}
        </span>
      )}
      <PromptInputButton
        tooltip={{ content: label }}
        aria-label={label}
        aria-pressed={state === 'recording'}
        disabled={disabled || state === 'transcribing'}
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          onToggle();
        }}
      >
        {icon}
      </PromptInputButton>
      {state === 'recording' && (
        <span className="ml-1 inline-flex items-center gap-1 text-[11px] tabular-nums text-red-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
          {tVoice('dictation.recordingElapsed', { time: formatElapsed(elapsed) })}
        </span>
      )}
      {canRetry && state === 'idle' && onRetry && (
        <PromptInputButton
          tooltip={{ content: tVoice('dictation.retry') }}
          aria-label={tVoice('dictation.retry')}
          onClick={(e: { preventDefault: () => void }) => {
            e.preventDefault();
            onRetry();
          }}
        >
          <RotateCcw />
        </PromptInputButton>
      )}
    </span>
  );
}
