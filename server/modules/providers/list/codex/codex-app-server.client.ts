import {
  codexAppServerRuntime,
  type CodexThreadFork,
  type CodexThreadForkInput,
} from '@/modules/providers/list/codex/index.js';

export type { CodexThreadFork };

/**
 * Compatibility facade consumed by Codex's fork and message-editing adapters.
 * Requests share the supervised long-lived process used by Codex chat instead
 * of spawning a second app-server implementation for every operation.
 */
export const codexAppServer: {
  forkThread(input: CodexThreadForkInput): Promise<CodexThreadFork>;
} = {
  forkThread: (input) => codexAppServerRuntime.forkThread(input),
};
