import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';
import { PromptInputButton } from '../../../../shared/view/ui';

type Props = {
  onTranscript: (text: string) => void;
  onError?: (msg: string) => void;
};

// Push-to-talk mic button. Renders nothing unless the optional voice feature is enabled.
// Surfaces transcription errors itself (transiently) so they aren't silently swallowed.
export default function VoiceInputButton({ onTranscript, onError }: Props) {
  const { t } = useTranslation('chat');
  const available = useVoiceAvailable();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleError = (msg: string) => {
    onError?.(msg);
    setErrorMsg(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setErrorMsg(null), 4000);
  };

  const { state, toggle } = useVoiceInput(onTranscript, handleError);

  useEffect(() => () => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  if (!available) return null;

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
          {errorMsg}
        </span>
      )}
      <PromptInputButton
        tooltip={{ content: state === 'recording' ? t('voice.stopRecording') : t('voice.input') }}
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          toggle();
        }}
      >
        {icon}
      </PromptInputButton>
    </span>
  );
}
