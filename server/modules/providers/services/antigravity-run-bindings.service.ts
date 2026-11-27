import { normalizeProjectPath } from '@/shared/index.js';

/** Owns the short startup interval before a native init event binds its exact app row. */
class AntigravityRunBindings {
  private readonly pendingProjects = new Map<symbol, string>();

  trackPendingRun(projectPath: string): () => void {
    const token = Symbol();
    this.pendingProjects.set(token, normalizeProjectPath(projectPath));
    return () => { this.pendingProjects.delete(token); };
  }

  hasPendingRun(projectPath: string): boolean {
    const normalized = normalizeProjectPath(projectPath);
    return [...this.pendingProjects.values()].some((project) => project === normalized);
  }
}

/** Antigravity runtime and synchronizer use this to defer watcher indexing only during active startup. */
export const antigravityRunBindings = new AntigravityRunBindings();
