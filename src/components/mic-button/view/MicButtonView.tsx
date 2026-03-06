import { Brain, Loader2, Mic } from 'lucide-react';
import type { MouseEvent, ReactElement } from 'react';
import { BUTTON_BACKGROUND_BY_STATE, MIC_BUTTON_STATES } from '../constants/constants';
import type { MicButtonState } from '../types/types';

type MicButtonViewProps = {
  state: MicButtonState;
  error: string | null;
  isSupported: boolean;
  className: string;
  onButtonClick: (event?: MouseEvent<HTMLButtonElement>) => void;
};

const getButtonIcon = (state: MicButtonState, isSupported: boolean): ReactElement => {
  if (!isSupported) {
    return <Mic className="h-5 w-5" />;
  }

  if (state === MIC_BUTTON_STATES.TRANSCRIBING) {
    return <Loader2 className="h-5 w-5 animate-spin" />;
  }

  if (state === MIC_BUTTON_STATES.PROCESSING) {
    return <Brain className="h-5 w-5 animate-pulse" />;
  }

  if (state === MIC_BUTTON_STATES.RECORDING) {
    return <Mic className="h-5 w-5 text-white" />;
  }

  return <Mic className="h-5 w-5" />;
};

export default function MicButtonView({
  state,
  error,
  isSupported,
  className,
  onButtonClick,
}: MicButtonViewProps) {
  const isDisabled = !isSupported || state === MIC_BUTTON_STATES.TRANSCRIBING || state === MIC_BUTTON_STATES.PROCESSING;
  const icon = getButtonIcon(state, isSupported);

  return (
    <div className="relative">
      <button
        type="button"
        style={{ backgroundColor: BUTTON_BACKGROUND_BY_STATE[state] }}
        className={`
          touch-action-manipulation flex h-12
          w-12 items-center justify-center
          rounded-full text-white transition-all
          duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500
          focus:ring-offset-2
          dark:ring-offset-gray-800
          ${isDisabled ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}
          ${state === MIC_BUTTON_STATES.RECORDING ? 'animate-pulse' : ''}
          hover:opacity-90
          ${className}
        `}
        onClick={onButtonClick}
        disabled={isDisabled}
      >
        {icon}
      </button>

      {error && (
        <div
          className="animate-fade-in absolute left-1/2 top-full z-10 mt-2
                        -translate-x-1/2 transform whitespace-nowrap rounded bg-red-500 px-2 py-1 text-xs
                        text-white"
        >
          {error}
        </div>
      )}

      {state === MIC_BUTTON_STATES.RECORDING && (
        <div className="pointer-events-none absolute -inset-1 animate-ping rounded-full border-2 border-red-500" />
      )}

      {state === MIC_BUTTON_STATES.PROCESSING && (
        <div className="pointer-events-none absolute -inset-1 animate-ping rounded-full border-2 border-purple-500" />
      )}
    </div>
  );
}
