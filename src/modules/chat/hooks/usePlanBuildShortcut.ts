import { useEffect } from 'react';

import type { PendingPermissionRequest } from '@/shared/types';

type UsePlanBuildShortcutArgs = {
  /** Whether the chat tab is the one on screen; a hidden chat must not react. */
  isActive: boolean;
  /** The pending plan approval (ExitPlanMode) of the open session, if any. */
  pendingPlanRequest: PendingPermissionRequest | null;
  /** The "Build approved plans in" setting the shortcut follows. */
  buildInNewSession: boolean;
  onBuildPlan: (request: PendingPermissionRequest, inNewSession: boolean) => void;
};

/**
 * ⌘↩ / Ctrl+↩ builds a pending plan the way the plan card's main Build button
 * does. Listened for once per chat rather than per plan card, because every plan
 * card in a transcript offers the same pending request.
 *
 * Text in the focused field wins: in the composer those keys already send it, so
 * the shortcut only builds from an empty field or from outside one.
 */
export function usePlanBuildShortcut({
  isActive,
  pendingPlanRequest,
  buildInNewSession,
  onBuildPlan,
}: UsePlanBuildShortcutArgs) {
  useEffect(() => {
    if (!isActive || !pendingPlanRequest) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter'
        || !(event.metaKey || event.ctrlKey)
        || event.shiftKey
        || event.altKey
        || event.repeat
        || event.isComposing
      ) {
        return;
      }
      // A menu or modal open over the chat, the Build menu included, owns the
      // keyboard; the plan behind it is not what the keys are aimed at.
      if (document.querySelector('[data-escape-layer]')) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement
        && (
          target.isContentEditable
          || ((target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && target.value.trim())
        )
      ) {
        return;
      }

      event.preventDefault();
      onBuildPlan(pendingPlanRequest, buildInNewSession);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [buildInNewSession, isActive, onBuildPlan, pendingPlanRequest]);
}
