import { api } from '@/shared/api';

/**
 * Which sessions read every assistant turn aloud as it completes.
 *
 * Lives outside React, next to voicePlayer, because the composer toggle, the
 * realtime handler and the send path all need the same answer and the realtime
 * handler is not a component. The server owns the value; this caches it so the
 * toggle paints immediately and the completion handler can answer synchronously.
 */
class AutoSpeakSessions {
  private enabledBySession = new Map<string, boolean>();
  private inFlightLoads = new Map<string, Promise<boolean>>();
  private listeners = new Set<() => void>();
  private inFlightWrites = new Map<string, Promise<void>>();
  /** Increments per write, so a slow one cannot undo a newer toggle. */
  private writeRevisionBySession = new Map<string, number>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Synchronous answer for one session, defaulting to off — including while the
   * first load is in flight, which errs toward silence rather than surprise.
   */
  isEnabled(sessionId: string | null | undefined): boolean {
    if (!sessionId) return false;
    return this.enabledBySession.get(sessionId) === true;
  }

  /** Fetches a session's setting once; repeat calls reuse the same request. */
  async load(sessionId: string): Promise<boolean> {
    const cached = this.enabledBySession.get(sessionId);
    if (cached !== undefined) return cached;

    const existingLoad = this.inFlightLoads.get(sessionId);
    if (existingLoad) return existingLoad;

    const load = (async () => {
      try {
        const response = await api.providers.sessionAutoSpeak(sessionId);
        if (!response.ok) return false;
        const body = await response.json();
        return body?.data?.autoSpeak === true;
      } catch {
        // Left unset so the next mount retries rather than caching a false negative.
        return false;
      } finally {
        this.inFlightLoads.delete(sessionId);
      }
    })();

    this.inFlightLoads.set(sessionId, load);
    const enabled = await load;
    // Only positives are recorded: a `false` from a failed request is
    // indistinguishable from a real "off" and would block the retry above.
    if (enabled) {
      this.enabledBySession.set(sessionId, true);
      this.emit();
    }
    return enabled;
  }

  /**
   * Writes optimistically, then persists. A failed write is recoverable by
   * clicking again, so the local value is not rolled back — but the entry is
   * dropped so the next load re-reads the server's truth.
   *
   * Writes for one session run one after another, because two quick toggles
   * otherwise race and the server can keep whichever request happens to land
   * last rather than the one the user asked for last.
   */
  async set(sessionId: string, enabled: boolean): Promise<void> {
    this.enabledBySession.set(sessionId, enabled);
    this.emit();

    const revision = (this.writeRevisionBySession.get(sessionId) ?? 0) + 1;
    this.writeRevisionBySession.set(sessionId, revision);

    const previousWrite = this.inFlightWrites.get(sessionId) ?? Promise.resolve();
    const write = previousWrite
      .catch(() => {})
      .then(async () => {
        try {
          const response = await api.providers.setSessionAutoSpeak(sessionId, enabled);
          if (!response.ok) throw new Error(`Failed to save auto read-aloud (${response.status})`);
        } catch (error) {
          console.error('Failed to persist auto read-aloud setting:', error);
          // Only the newest write may drop the cache: an older failure would
          // otherwise discard a value the user has since chosen again.
          if (this.writeRevisionBySession.get(sessionId) !== revision) return;
          this.enabledBySession.delete(sessionId);
          this.emit();
        }
      })
      .finally(() => {
        if (this.inFlightWrites.get(sessionId) === write) {
          this.inFlightWrites.delete(sessionId);
        }
      });

    this.inFlightWrites.set(sessionId, write);
    return write;
  }

  toggle(sessionId: string): void {
    void this.set(sessionId, !this.isEnabled(sessionId));
  }
}

export const autoSpeakSessions = new AutoSpeakSessions();
