/**
 * Ids of opencode side-question forks that are running or awaiting delete.
 *
 * A fork session is created by `opencode run --fork` before its id is known
 * to be a side question anywhere else (opencode's own `session.agent` column
 * is set only once the row exists). The id is added here as soon as it is
 * read off the fork's events, and removed only after `opencode session
 * delete` on that id has finished — so a watcher that races the delete still
 * sees the fork as one to skip, not a new sidebar session.
 */
export type OpenCodeSideQuestionForkRegistry = {
  add(id: string): void;
  delete(id: string): void;
  has(id: string): boolean;
  /** A snapshot of the registered ids, for the synchronizer's SQL exclusion. */
  list(): string[];
};

function createOpenCodeSideQuestionForkRegistry(): OpenCodeSideQuestionForkRegistry {
  const ids = new Set<string>();
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
    list(): string[] {
      return Array.from(ids);
    },
  };
}

export const opencodeSideQuestionForks = createOpenCodeSideQuestionForkRegistry();
