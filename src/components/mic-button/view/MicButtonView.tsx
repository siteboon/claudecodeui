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
    return <Mic className="w-5 h-5" />;
  }

  if (state === MIC_BUTTON_STATES.TRANSCRIBING) {
    return <Loader2 className="w-5 h-5 animate-spin" />;
  }

  if (state === MIC_BUTTON_STATES.PROCESSING) {
    return <Brain className="w-5 h-5 animate-pulse" />;
  }

  if (state === MIC_BUTTON_STATES.RECORDING) {
    return <Mic className="w-5 h-5 text-white" />;
  }

  return <Mic className="w-5 h-5" />;
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
          flex items-center justify-center
          w-12 h-12 rounded-full
          text-white transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
          dark:ring-offset-gray-800
          touch-action-manipulation
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
          className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2
                        bg-red-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10
                        animate-fade-in"
        >
          {error}
        </div>
      )}

      {state === MIC_BUTTON_STATES.RECORDING && (
        <div className="absolute -inset-1 rounded-full border-2 border-red-500 animate-ping pointer-events-none" />
      )}

      {state === MIC_BUTTON_STATES.PROCESSING && (
        <div className="absolute -inset-1 rounded-full border-2 border-purple-500 animate-ping pointer-events-none" />
      )}
    </div>
  );
}
