/**
 * Side-question fork tracking for opencode, confirmed ids and the pending
 * window before an id is known.
 *
 * `opencode run --fork` creates the forked session row with `agent` left
 * `NULL` — opencode sets it asynchronously, in practice well before the run's
 * first stdout event but not provably before it — and keeps reusing the
 * parent's own title with a `(fork #N)` suffix; a `--title` passed to the
 * fork is ignored (both verified live against 1.18.30, 2026-10-27). So before
 * the fork's id is read off an event, the only marker available is
 * (directory, a start time taken just before spawn, that title suffix):
 * `registerPending`/`listPending` hand that marker to the synchronizer's SQL
 * exclusion, and `opencode-runtime.provider.js` uses the same marker to find
 * and delete a fork whose run ended before any id arrived.
 */
type PendingOpenCodeSideQuestionFork = {
  directory: string;
  startedAt: number;
};

function createOpenCodeSideQuestionForkRegistry() {
  const ids = new Set<string>();
  const pending = new Map<symbol, PendingOpenCodeSideQuestionFork>();

  return {
    add(id: string): void {
      ids.add(id);
    },
    delete(id: string): void {
      ids.delete(id);
    },
    has(id: string): boolean {
      return ids.has(id);
    },
    /** A snapshot of the registered ids, for the synchronizer's SQL exclusion. */
    list(): string[] {
      return Array.from(ids);
    },
    /**
     * Marks a fork about to be spawned, before its id can be read off any
     * event. Returns a token `clearPending` removes once the id is known (or
     * the run ends without one ever arriving).
     */
    registerPending(directory: string, startedAt: number): symbol {
      const token = Symbol('opencode-side-question-pending-fork');
      pending.set(token, { directory, startedAt });
      return token;
    },
    clearPending(token: symbol): void {
      pending.delete(token);
    },
    /** A snapshot of the pending windows, for the synchronizer's SQL exclusion. */
    listPending(): PendingOpenCodeSideQuestionFork[] {
      return Array.from(pending.values());
    },
  };
}

// Consumed by opencode-runtime.provider.js, which registers a pending fork
// before spawning, confirms it with an id once an event names one (or clears
// it unconfirmed on an early exit), and by OpenCodeSessionSynchronizer, which
// excludes both the pending window and the confirmed ids from the sidebar in
// its SQL.
export const opencodeSideQuestionForks = createOpenCodeSideQuestionForkRegistry();
