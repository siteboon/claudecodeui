import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SemanticHelperPlatform = 'darwin' | 'win32';

export type SemanticHelperResolution = {
  available: boolean;
  path: string | null;
  source: 'bundled' | 'dev' | 'missing';
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  reason?: string;
};

function helperExecutableName(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') {
    return 'CloudCLISemantics';
  }
  if (platform === 'win32') {
    return 'CloudCLISemantics.exe';
  }
  return null;
}

function pathExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    try {
      fs.accessSync(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function candidatePaths(platform: NodeJS.Platform, arch: NodeJS.Architecture): Array<{ source: 'bundled' | 'dev'; path: string }> {
  const executable = helperExecutableName(platform);
  if (!executable) {
    return [];
  }

  const platformArch = `${platform}-${arch}`;
  return [
    {
      source: 'bundled',
      path: path.resolve(__dirname, '..', 'bin', platformArch, executable),
    },
    {
      source: 'dev',
      path: path.resolve(process.cwd(), 'server', 'modules', 'computer-use', 'semantics', 'bin', platformArch, executable),
    },
  ];
}

export function resolveSemanticHelper(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): SemanticHelperResolution {
  const executable = helperExecutableName(platform);
  if (!executable) {
    return {
      available: false,
      path: null,
      source: 'missing',
      platform,
      arch,
      reason: `Semantic Computer Use helper is not supported on ${platform}.`,
    };
  }

  for (const candidate of candidatePaths(platform, arch)) {
    if (pathExists(candidate.path)) {
      return {
        available: true,
        path: candidate.path,
        source: candidate.source,
        platform,
        arch,
      };
    }
  }

  return {
    available: false,
    path: null,
    source: 'missing',
    platform,
    arch,
    reason: `Bundled semantic helper was not found for ${platform}-${arch} (${executable}).`,
  };
}
