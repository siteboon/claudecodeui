import { Volume2, Loader2, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTts } from '../../hooks/useTts';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';

// Tap-to-speak button beside the copy control on assistant messages.
// Renders nothing unless the optional voice feature is enabled.
const MessageSpeakControl = ({ content }: { content: string }) => {
  const { t } = useTranslation('chat');
  const available = useVoiceAvailable();
  const { state, toggle } = useTts(() => content);

  if (!available) return null;

  const title =
    state === 'playing' ? t('voice.stopSpeaking') : state === 'loading' ? t('voice.loading') : t('voice.speak');

  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      aria-label={title}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
    >
      {state === 'playing' ? (
        <Square className="h-3.5 w-3.5" />
      ) : state === 'loading' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" />
      )}
    </button>
  );
};

export default MessageSpeakControl;
