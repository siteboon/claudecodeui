import { Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PromptInputButton } from '@/modules/chat/composer/PromptInput';

type Props = {
  enabled: boolean;
  onToggle: () => void;
};

/**
 * Rendered by chat's ChatComposer beside the mic button.
 *
 * Turns auto read-aloud on or off for the current session. It sits in the
 * composer rather than in Quick Settings because it is a per-conversation
 * choice, and because it is the control you reach for the moment a reply starts
 * talking when you did not want it to.
 */
export default function AutoSpeakToggle({ enabled, onToggle }: Props) {
  const { t } = useTranslation('chat');

  return (
    <PromptInputButton
      tooltip={{ content: enabled ? t('voice.autoSpeakOn') : t('voice.autoSpeakOff') }}
      aria-label={enabled ? t('voice.autoSpeakOn') : t('voice.autoSpeakOff')}
      aria-pressed={enabled}
      onClick={(event: { preventDefault: () => void }) => {
        event.preventDefault();
        onToggle();
      }}
      className={enabled ? 'text-primary' : undefined}
    >
      {enabled ? <Volume2 /> : <VolumeX />}
    </PromptInputButton>
  );
}
