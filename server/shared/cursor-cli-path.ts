import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolves the Cursor agent CLI command.
 *
 * Cursor's official CLI installs as `agent` (curl https://cursor.com/install
 * -fsS | bash puts `agent` in ~/.local/bin), while this codebase and older
 * setups used `cursor-agent`. Prefer an explicit CURSOR_CLI_PATH override,
 * then whichever of `cursor-agent` / `agent` actually exists on PATH (checked
 * once and cached), falling back to `cursor-agent` to preserve prior behavior.
 */

type ResolveCursorAgentDependencies = {
  existsSync?: (p: string) => boolean;
  env?: NodeJS.ProcessEnv;
};

const CANDIDATES = ['cursor-agent', 'agent'];

let cached: string | null = null;

const isExecutableOnPath = (
  command: string,
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean,
): boolean => {
  const pathValue = (env.PATH || '').split(path.delimiter);
  return pathValue.some((dir) => dir && exists(path.join(dir, command)));
};

export function resolveCursorAgentCommand(
  dependencies: ResolveCursorAgentDependencies = {},
): string {
  const deps: Required<ResolveCursorAgentDependencies> = {
    existsSync: dependencies.existsSync ?? existsSync,
    env: dependencies.env ?? process.env,
  };

  const explicit = (deps.env.CURSOR_CLI_PATH || '').trim();
  if (explicit) {
    return explicit;
  }

  if (cached) {
    return cached;
  }

  for (const candidate of CANDIDATES) {
    if (isExecutableOnPath(candidate, deps.env, deps.existsSync)) {
      cached = candidate;
      return candidate;
    }
  }

  // No candidate on PATH; keep the historical default.
  return 'cursor-agent';
}
