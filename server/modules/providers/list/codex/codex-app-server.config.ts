export type CodexRuntimeMode = 'app-server' | 'sdk';

export const CODEX_RUNTIME_MODE_ENV = 'CLOUDCLI_CODEX_RUNTIME_MODE';
export const DEFAULT_CODEX_RUNTIME_MODE: CodexRuntimeMode = 'app-server';

/**
 * Reads the default Codex runtime mode for non-browser callers.
 */
export function readCodexRuntimeMode(
  env: NodeJS.ProcessEnv = process.env,
): CodexRuntimeMode {
  const configured = env[CODEX_RUNTIME_MODE_ENV]?.trim().toLowerCase();
  if (configured === 'app-server' || configured === 'sdk') {
    return configured;
  }

  return DEFAULT_CODEX_RUNTIME_MODE;
}

/** Resolves a per-request setting, or uses the server default when omitted. */
export function resolveCodexRuntimeMode(
  requested: unknown,
  env: NodeJS.ProcessEnv = process.env,
): CodexRuntimeMode {
  if (requested === 'app-server' || requested === 'sdk') {
    return requested;
  }

  return readCodexRuntimeMode(env);
}
