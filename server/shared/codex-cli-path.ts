/**
 * Remove matching single or double quotes around a configured executable path.
 */
function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Resolve the optional Codex CLI override from an explicit value or CODEX_CLI_PATH.
 */
export function resolveCodexExecutablePath(
  configuredPath: string | undefined = process.env.CODEX_CLI_PATH,
): string | undefined {
  const normalizedPath = stripWrappingQuotes(configuredPath || '');
  return normalizedPath || undefined;
}
