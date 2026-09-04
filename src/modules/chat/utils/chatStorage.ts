import type { ClaudeSettings } from '@/shared/types';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

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
    projectSortOrder: readUserPreference<ClaudeSettings['projectSortOrder']>('projectSortOrder', 'name'),
  };
}

/** Persists Claude's tool permissions after the user grants one from the chat. */
export function saveClaudePermissions(permissions: {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
}): void {
  writeUserPreference('claudePermissions', permissions);
}

export type StoredQueuedMessage = {
  content: string;
  options?: QueuedSendOptions;
  /** Legacy image-only descriptors retained for queued draft compatibility. */
  images?: unknown[];
  /**
   * JSON-safe descriptors returned by POST /api/assets/files. Unlike browser
   * File objects, they can follow a queued message across session switches.
   */
  attachments?: unknown[];
}

export function readQueuedMessage(sessionId: string): StoredQueuedMessage | null {
  const raw = safeLocalStorage.getItem(queuedMessageKey(sessionId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as StoredQueuedMessage).content === 'string') {
      const { content, options, images, attachments } = parsed as StoredQueuedMessage;
      const normalizedAttachments = Array.isArray(attachments)
        ? attachments
        : Array.isArray(images)
          ? images
          : [];
      return content.trim() || normalizedAttachments.length > 0
        ? { content, options, attachments: normalizedAttachments }
        : null;
    }
  } catch {
    // Legacy format: the raw draft text itself.
  }

  return raw.trim() ? { content: raw } : null;
}

export function writeQueuedMessage(sessionId: string, message: StoredQueuedMessage): void {
  safeLocalStorage.setItem(queuedMessageKey(sessionId), JSON.stringify(message));
}

export function clearQueuedMessage(sessionId: string): void {
  safeLocalStorage.removeItem(queuedMessageKey(sessionId));
}

export type QueuedSendOptions = Record<string, unknown>;

export const queuedMessageKey = (sessionId: string) => `queued_message_${sessionId}`;
