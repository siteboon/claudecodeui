import { useMicButtonController } from '../hooks/useMicButtonController';
import MicButtonView from './MicButtonView';

type MicButtonProps = {
  onTranscript?: (transcript: string) => void;
  className?: string;
  mode?: string;
};

export default function MicButton({
  onTranscript,
  className = '',
  mode: _mode,
}: MicButtonProps) {
  const { state, error, isSupported, handleButtonClick } = useMicButtonController({
    onTranscript,
  });

  // Keep `mode` in the public props for backwards compatibility.
  void _mode;

  return (
    <MicButtonView
      state={state}
      error={error}
      isSupported={isSupported}
      className={className}
      onButtonClick={handleButtonClick}
    />
  );
}

