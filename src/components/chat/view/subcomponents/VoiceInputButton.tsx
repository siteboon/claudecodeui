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
export default function VoiceInputButton({ onTranscript, onError }: Props) {
  const { t } = useTranslation('chat');
  const available = useVoiceAvailable();
  const { state, toggle } = useVoiceInput(onTranscript, onError);

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
    <PromptInputButton
      tooltip={{ content: state === 'recording' ? t('voice.stopRecording') : t('voice.input') }}
      onClick={(e: { preventDefault: () => void }) => {
        e.preventDefault();
        toggle();
      }}
    >
      {icon}
    </PromptInputButton>
  );
}
