import type { ClaudeSettings } from '../types/types';

export const CLAUDE_SETTINGS_KEY = 'claude-settings';

export const safeLocalStorage = {
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');

        const keys = Object.keys(localStorage);
        const draftKeys = keys.filter((k) => k.startsWith('draft_input_') || k.startsWith('queued_message_'));
        draftKeys.forEach((k) => {
          localStorage.removeItem(k);
        });

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
 * Composer options captured when a message is queued, so the message can be
 * sent later with the exact settings (model, permission mode, tools) the
 * session's composer had at queue time — even from outside the composer,
 * e.g. the app-level auto-send that fires while another session is viewed.
 */
export type QueuedSendOptions = Record<string, unknown>;

export type StoredQueuedMessage = {
  content: string;
  options?: QueuedSendOptions;
  /**
   * For queued custom slash commands, the fully expanded prompt to dispatch
   * verbatim (the tagged wrapper for Claude, the plain body otherwise). The
   * app-level auto-send has no access to slash-command re-interception, so it
   * must send this instead of the compact `content` — otherwise the provider
   * receives an un-expanded "/name args" string. The in-composer flush ignores
   * this field and re-expands `content` live (issue #1009).
   */
  promptContent?: string;
};

export const queuedMessageKey = (sessionId: string) => `queued_message_${sessionId}`;

/**
 * Reads a session's queued message. Understands both the JSON
 * `{ content, options }` format and the legacy raw-text format.
 */
export function readQueuedMessage(sessionId: string): StoredQueuedMessage | null {
  const raw = safeLocalStorage.getItem(queuedMessageKey(sessionId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as StoredQueuedMessage).content === 'string') {
      const { content, options, promptContent } = parsed as StoredQueuedMessage;
      // Persisted data is untrusted — drop a malformed promptContent instead
      // of letting a non-string reach the auto-send dispatch.
      return content.trim()
        ? { content, options, promptContent: typeof promptContent === 'string' ? promptContent : undefined }
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

export function getClaudeSettings(): ClaudeSettings {
  const raw = safeLocalStorage.getItem(CLAUDE_SETTINGS_KEY);
  if (!raw) {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name',
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      allowedTools: Array.isArray(parsed.allowedTools) ? parsed.allowedTools : [],
      disallowedTools: Array.isArray(parsed.disallowedTools) ? parsed.disallowedTools : [],
      skipPermissions: Boolean(parsed.skipPermissions),
      projectSortOrder: parsed.projectSortOrder || 'name',
    };
  } catch {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name',
    };
  }
}
