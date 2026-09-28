import type { ClaudePermissionsState, ClaudeSettings } from '@/shared/types';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';
import { readPermissionPromptTimeoutMs } from '@/shared/utils';

export const safeLocalStorage = {
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');

        // The draft mirror is the largest disposable thing in storage, and
        // dropping it costs nothing: the server copy is authoritative and is
        // read back on the next hydrate.
        localStorage.removeItem('chat-drafts');

        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
        }
      } else {
        console.error('localStorage error:', error);
      }
    }
  },
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('localStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('localStorage removeItem error:', error);
    }
  },
};


/**
 * Claude's tool-permission settings, stored in auth.db so the allow-list a user
 * builds up on one machine applies on the next.
 *
 * `projectSortOrder` is a separate preference now, but stays on the returned
 * object because ClaudeSettings still describes the whole legacy blob.
 */
export function getClaudeSettings(): ClaudeSettings {
  const stored = readUserPreference<Partial<ClaudeSettings>>('claudePermissions', {});

  return {
    allowedTools: Array.isArray(stored.allowedTools) ? stored.allowedTools : [],
    disallowedTools: Array.isArray(stored.disallowedTools) ? stored.disallowedTools : [],
    skipPermissions: Boolean(stored.skipPermissions),
    permissionPromptTimeoutMs: readPermissionPromptTimeoutMs(stored.permissionPromptTimeoutMs),
    projectSortOrder: readUserPreference<ClaudeSettings['projectSortOrder']>('projectSortOrder', 'name'),
  };
}

/**
 * Persists Claude's permission settings after the user grants a tool from the
 * chat. The preference is replaced as a whole, so the caller passes every field
 * (including the prompt timeout set in Settings) to avoid resetting one.
 */
export function saveClaudePermissions(permissions: ClaudePermissionsState): void {
  writeUserPreference('claudePermissions', permissions);
}
