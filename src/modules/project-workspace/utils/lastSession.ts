/**
 * The conversation this browser had open last.
 *
 * CloudCLI reads "no session id in the URL" as "the user wants a new chat", so
 * any loss of page context (reopening the tab, coming back to the root path)
 * silently made the next message a *second* session: the conversation on screen
 * stayed untouched and the same task ran twice. The root path now reopens the
 * conversation recorded here, and `/new` is the only state that starts a fresh
 * chat on send.
 *
 * Kept per browser rather than on the server: which conversation is "the one I
 * was in" is a property of the device being used, and a phone picking up the
 * desktop's last session would be the same surprise in reverse.
 */
const LAST_OPENED_SESSION_STORAGE_KEY = 'cloudcli:last-opened-session';

/** One conversation the user had open, with the project it belongs to. */
export type LastOpenedSession = {
  sessionId: string;
  projectId: string | null;
  /** Epoch milliseconds of the last time the conversation was on screen. */
  updatedAt: number;
};

export function readLastOpenedSession(): LastOpenedSession | null {
  try {
    const raw = localStorage.getItem(LAST_OPENED_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<LastOpenedSession> | null;
    if (!parsed || typeof parsed.sessionId !== 'string' || !parsed.sessionId) {
      return null;
    }

    return {
      sessionId: parsed.sessionId,
      projectId: typeof parsed.projectId === 'string' && parsed.projectId ? parsed.projectId : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function rememberLastOpenedSession(sessionId: string, projectId?: string | null): void {
  try {
    localStorage.setItem(
      LAST_OPENED_SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionId,
        projectId: typeof projectId === 'string' && projectId ? projectId : null,
        updatedAt: Date.now(),
      } satisfies LastOpenedSession),
    );
  } catch {
    // Storage being unavailable (private mode, quota) only costs the restore.
  }
}

/** Called when the user asks for a new chat: the root path must not reopen the old one afterwards. */
export function forgetLastOpenedSession(): void {
  try {
    localStorage.removeItem(LAST_OPENED_SESSION_STORAGE_KEY);
  } catch {
    // Storage being unavailable means there is nothing to forget.
  }
}