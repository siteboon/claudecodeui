import { useEffect } from 'react';

type UseEscapeToStopRunArgs = {
  /** Whether the open session has a run that can be stopped right now. */
  canAbortSession: boolean;
  onAbortSession: () => void;
};

/**
 * Escape anywhere in the chat stops the open session's run. Listened for on the
 * document in the capture phase, ahead of the focused element's own handlers.
 */
export function useEscapeToStopRun({ canAbortSession, onAbortSession }: UseEscapeToStopRunArgs) {
  useEffect(() => {
    if (!canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }
      // An open menu or modal marks itself with `data-escape-layer` and takes
      // this Escape to close. Stopping the run as well would make dismissing the
      // plan card's Build menu discard the plan waiting for approval.
      if (document.querySelector('[data-escape-layer]')) {
        return;
      }

      event.preventDefault();
      onAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, onAbortSession]);
}
