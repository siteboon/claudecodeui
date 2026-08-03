/**
 * PiTokenUsageProvider - derives a session's token usage from the last valid
 * assistant usage on the active branch, as computed by {@link PiSessionStore}.
 *
 * Pi does not fall back to another provider's default usage: when the session
 * snapshot carries no qualifying usage, `getTokenUsage` returns `null`.
 */
import { PiSessionStore } from './pi-session-store.provider.js';

/** Token usage shape returned to the central token-usage service. */
export interface PiTokenUsage {
  used: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheTokens: number;
  breakdown: {
    input: number;
    output: number;
  };
}

type SessionLoader = (filePath: string) => { lastUsage: import('./pi-session-store.provider.js').PiUsage | null };

export class PiTokenUsageProvider {
  private readonly load: SessionLoader;

  constructor(deps: { load?: SessionLoader } = {}) {
    this.load = deps.load ?? ((filePath) => PiSessionStore.load(filePath));
  }

  /**
   * Returns the token usage for a Pi session file, or `null` when the snapshot
   * has no last valid usage.
   */
  getTokenUsage(sessionFilePath: string): PiTokenUsage | null {
    const snapshot = this.load(sessionFilePath);
    const usage = snapshot.lastUsage;
    if (!usage) {
      return null;
    }

    return {
      used: usage.totalTokens,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheCreationTokens: usage.cacheWrite,
      cacheTokens: usage.cacheRead + usage.cacheWrite,
      breakdown: {
        input: usage.input,
        output: usage.output,
      },
    };
  }
}
