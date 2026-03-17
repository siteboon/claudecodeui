import { getPlatformLineEnding, getPlatformPathSeparator, resolveRuntimePlatform } from './runtime-platform.js';
import type { RuntimePlatform, ShellSpawnPlan } from './types.js';

// This helper returns the shell executable and argv shape for the target platform.
export function createShellSpawnPlan(
  command: string,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): ShellSpawnPlan {
  if (platform === 'windows') {
    return {
      platform,
      executable: 'powershell.exe',
      args: ['-Command', command],
      commandFlag: '-Command',
      preferredLineEnding: getPlatformLineEnding(platform),
      pathSeparator: getPlatformPathSeparator(platform),
    };
  }

  return {
    platform,
    executable: 'bash',
    args: ['-c', command],
    commandFlag: '-c',
    preferredLineEnding: getPlatformLineEnding(platform),
    pathSeparator: getPlatformPathSeparator(platform),
  };
}

// This helper quotes one argument so the caller does not need to remember shell-specific escaping rules.
export function quoteShellArgument(
  value: string,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): string {
  if (platform === 'windows') {
    // PowerShell escapes a single quote inside a single-quoted string by doubling it.
    return `'${value.replace(/'/g, "''")}'`;
  }

  // POSIX shells escape a single quote by closing the string, injecting an escaped quote, and reopening it.
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

// This helper builds the platform-specific "try primary, then fallback" shell expression.
export function buildFallbackCommand(
  primaryCommand: string,
  fallbackCommand: string,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): string {
  if (platform === 'windows') {
    return `${primaryCommand}; if ($LASTEXITCODE -ne 0) { ${fallbackCommand} }`;
  }

  return `${primaryCommand} || ${fallbackCommand}`;
}
