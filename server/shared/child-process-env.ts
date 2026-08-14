// Environment scrubbing for spawned child processes.

/**
 * Variables that configure *this* server instance and must not be inherited by
 * child processes.
 *
 * DATABASE_PATH is the dangerous one: a dev server started from an in-app
 * terminal inherits it and opens the running production database instead of its
 * own, so both processes hold the same SQLite file open.
 */
const SERVER_ONLY_ENV_KEYS = ['DATABASE_PATH'] as const;

/**
 * Returns a copy of `environment` without the variables that belong to this
 * server process. Use for any spawn/pty that runs user or project code.
 */
export function buildChildProcessEnv<T extends Record<string, string | undefined>>(
  environment: T,
): T {
  const childEnvironment = { ...environment };

  for (const key of SERVER_ONLY_ENV_KEYS) {
    delete childEnvironment[key];
  }

  return childEnvironment;
}
