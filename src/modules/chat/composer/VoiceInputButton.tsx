import { useCallback, useRef } from 'react';
import type { PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Square, Loader2 } from 'lucide-react';

import { PromptInputButton } from '@/modules/chat/composer/PromptInput';
import type { VoiceInputState } from '@/shared/types';

type Props = {
  state: VoiceInputState;
  onToggle: () => void;
  /** Press and hold: start recording. */
  onHoldStart?: () => void;
  /** Release after a hold: stop and send the transcript. */
  onHoldEnd?: () => void;
  errorMsg?: string | null;
};

/**
 * Push-to-talk mic button (presentational). Recording state and the
 * stop-and-send action are owned by the composer so the main Send button can
 * drive them too.
 *
 * Two ways to use it, the two the Claude extension offers as `voice.mode`:
 *
 *   hold  press and hold to record, release to stop - and submit, which is its
 *         `autoSubmit` on release. This is the extension's default.
 *   tap   a short click starts, the next click stops and drops the transcript
 *         in the box.
 *
 * Which one is meant is decided by how long the button was held rather than by
 * a setting: below the threshold it was a click, above it the user was holding
 * the button down to speak.
 */

/** Shorter than this and it was a click, not someone holding the button to talk. */
const HOLD_THRESHOLD_MS = 300;

export default function VoiceInputButton({
  state,
  onToggle,
  onHoldStart,
  onHoldEnd,
  errorMsg,
}: Props) {
  const { t } = useTranslation('chat');
  const pressedAt = useRef<number | null>(null);
  const startedByHold = useRef(false);

  const icon =
    state === 'recording' ? (
      <Square className="text-red-500" />
    ) : state === 'transcribing' ? (
      <Loader2 className="animate-spin" />
    ) : (
      <Mic />
    );

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (!onHoldStart) {
      return;
    }

    // Hold the pointer to this button, so a hand that drifts off it while
    // speaking still delivers the release here. Without that, sliding off
    // would cut the recording short mid-sentence.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressedAt.current = Date.now();
    // Whether this press is what started the recording decides what releasing
    // it means: the end of a hold, or the second tap that stops one.
    startedByHold.current = state === 'idle';
    if (state === 'idle') {
      onHoldStart();
    }
  }, [onHoldStart, state]);

  const onPointerUp = useCallback(() => {
    if (pressedAt.current === null) {
      return;
    }

    const held = Date.now() - pressedAt.current;
    pressedAt.current = null;

    // Held down and released: that was a hold, so stop and submit.
    if (startedByHold.current) {
      if (held >= HOLD_THRESHOLD_MS) {
        onHoldEnd?.();
      }
      // A short press only started it - the next tap stops it, below.
      return;
    }

    // Pressed while already recording: the second tap. Same ending as a hold.
    onHoldEnd?.();
  }, [onHoldEnd]);

  return (
    <span className="relative inline-flex">
      {errorMsg && (
        <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-red-600 px-2 py-1 text-xs text-white shadow-lg">
          {errorMsg}
        </span>
      )}
      <PromptInputButton
        // The shortcut is on the tooltip because that is where someone looks
        // for it: the key itself is the same on every language, so it is
        // appended rather than translated.
        tooltip={{
          content: `${state === 'recording' ? t('voice.stopRecording') : t('voice.input')} (Ctrl+D)`,
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        // A pointer the system takes away (a gesture, a lost device) ends the
        // hold as a release would; otherwise the recording would keep running
        // with nothing left to stop it.
        onPointerCancel={onPointerUp}
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          // Holding already started and stopped the recording; only a plain
          // click still has to toggle.
          if (!onHoldStart) {
            onToggle();
          }
        }}
      >
        {icon}
      </PromptInputButton>
    </span>
  );
}
