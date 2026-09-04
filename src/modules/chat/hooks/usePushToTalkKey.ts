import { useEffect, useRef } from 'react';

/**
 * Ctrl+D as push-to-talk: record while it is held, stop on release.
 *
 * The same gesture the mic button offers with a pointer, without reaching for
 * it - and the same shortcut the VS Code extension uses.
 *
 * Holding a shortcut down is not simply "keydown starts, keyup ends". Three
 * things get in the way, and each one would leave the microphone running:
 *
 *   - The browser repeats `keydown` while a key is held (`event.repeat`), so
 *     only the first one may start anything.
 *   - Releasing Ctrl before D produces `keyup` for "Control" and never one for
 *     "d" - the combination is over either way.
 *   - Switching windows mid-hold delivers no `keyup` at all, only `blur`.
 *
 * Ctrl+D is "add bookmark" in the browser, so the keydown is prevented - but
 * only while this is actually enabled, never as a blanket grab.
 */

type Options = {
  /** Off entirely when dictation is unavailable. */
  enabled: boolean;
  /** Whether something is being recorded right now. */
  isRecording: boolean;
  onStart: () => void;
  /** Called on release, and on anything that stands in for one. */
  onStop: () => void;
};

export function usePushToTalkKey({ enabled, isRecording, onStart, onStop }: Options): void {
  // The callbacks change identity on every render of the composer; keeping
  // them in refs means the listeners are attached once instead of being torn
  // down and rebuilt mid-hold.
  const startRef = useRef(onStart);
  const stopRef = useRef(onStop);
  const recordingRef = useRef(isRecording);
  /** Set while this shortcut is what started the recording. */
  const holding = useRef(false);

  startRef.current = onStart;
  stopRef.current = onStop;
  recordingRef.current = isRecording;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const release = () => {
      if (!holding.current) {
        return;
      }
      holding.current = false;
      stopRef.current();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key.toLowerCase() !== 'd' || event.repeat) {
        return;
      }

      // Taking the key from the browser only when it is going to be used.
      event.preventDefault();

      // Already recording - through the button, or a hold that is still
      // running. Pressing again must not start a second one.
      if (holding.current || recordingRef.current) {
        return;
      }

      holding.current = true;
      startRef.current();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'd' || event.key === 'Control') {
        release();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // No keyup arrives when the window loses focus mid-hold.
    window.addEventListener('blur', release);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      // Unmounting mid-hold must not leave the microphone open either.
      release();
    };
  }, [enabled]);
}

export default usePushToTalkKey;
