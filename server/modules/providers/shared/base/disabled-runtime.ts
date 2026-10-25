import type { IProviderFork, IProviderRuntime } from '@/shared/interfaces.js';

/**
 * Workbench runs agents only as the official CLIs inside a PTY (Shell tab).
 * Headless SDK runtimes are disabled so subscription auth is never used
 * outside those binaries.
 */
const DISABLED_MESSAGE =
  'Headless chat runs are disabled in Workbench. Start the agent from the terminal tab instead.';

export const disabledRuntime: IProviderRuntime = {
  async run() {
    throw new Error(DISABLED_MESSAGE);
  },
  abort() {
    return false;
  },
};

export const disabledFork: IProviderFork = {
  async forkSession() {
    throw new Error('Forking sessions is disabled in Workbench.');
  },
};
