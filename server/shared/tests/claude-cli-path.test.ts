import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveClaudeCodeExecutablePath,
  type ResolveClaudeCodeExecutablePathDependencies,
} from '@/shared/claude-cli-path.js';

/**
 * Builds an `existsSync` stub that treats exactly the listed paths as present.
 */
function existsOnly(...paths: string[]): ResolveClaudeCodeExecutablePathDependencies['existsSync'] {
  const present = new Set(paths.map((entry) => entry.toLowerCase()));
  return ((candidate: string) => present.has(candidate.toLowerCase())) as unknown as ResolveClaudeCodeExecutablePathDependencies['existsSync'];
}

const NPM_SHIM_CONTENT = 'exec node "$basedir/node_modules/@anthropic-ai/claude-code/cli.js" "$@"';
const readNpmShim = (() => NPM_SHIM_CONTENT) as unknown as ResolveClaudeCodeExecutablePathDependencies['readFileSync'];

test('resolveClaudeCodeExecutablePath resolves the npm Claude wrapper to its native exe on Windows', () => {
  const wrapperDir = 'C:\\nvm4w\\nodejs';
  const wrapperPath = `${wrapperDir}\\claude`;
  const nativePath = `${wrapperDir}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;

  const resolved = resolveClaudeCodeExecutablePath('claude', {
    platform: 'win32',
    pathEnvironment: wrapperDir,
    existsSync: existsOnly(wrapperPath, `${wrapperDir}\\claude.cmd`, nativePath),
    readFileSync: readNpmShim,
  });

  assert.equal(resolved, nativePath);
});

test('resolveClaudeCodeExecutablePath preserves non-ASCII characters in a PATH install directory', () => {
  // Regression: the previous `where.exe` based lookup decoded the console code
  // page output as UTF-8, turning `C:\Users\星辰\...` into unmappable
  // mojibake, which the SDK then reported as "native binary not found".
  const packageDir = 'C:\\Users\\星辰\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe';
  const nativePath = `${packageDir}\\claude.exe`;

  const resolved = resolveClaudeCodeExecutablePath(undefined, {
    platform: 'win32',
    pathEnvironment: packageDir,
    existsSync: existsOnly(nativePath),
    readFileSync: readNpmShim,
  });

  assert.equal(resolved, nativePath);
});

test('resolveClaudeCodeExecutablePath skips a PATH entry whose executable is missing', () => {
  // A stale PATH entry must never produce a phantom path the SDK cannot spawn.
  const resolved = resolveClaudeCodeExecutablePath(undefined, {
    platform: 'win32',
    pathEnvironment: 'C:\\Users\\星辰\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe',
    existsSync: () => false,
    readFileSync: readNpmShim,
  });

  assert.equal(resolved, undefined);
});

test('resolveClaudeCodeExecutablePath keeps an explicit JavaScript launcher path unchanged', () => {
  const scriptPath = 'C:\\tools\\claude.js';

  const resolved = resolveClaudeCodeExecutablePath(scriptPath, {
    platform: 'win32',
  });

  assert.equal(resolved, scriptPath);
});

test('resolveClaudeCodeExecutablePath can parse a wrapper file path containing letters r and n before claude.exe', () => {
  const wrapperPath = 'C:\\tools\\claude';
  const nativePath = 'C:\\tools\\custom\\bin\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
  const readFileSync = (() => 'exec "$basedir/custom/bin/node_modules/@anthropic-ai/claude-code/bin/claude.exe" "$@"') as unknown as ResolveClaudeCodeExecutablePathDependencies['readFileSync'];

  const resolved = resolveClaudeCodeExecutablePath(wrapperPath, {
    platform: 'win32',
    existsSync: existsOnly(nativePath),
    readFileSync,
  });

  assert.equal(resolved, nativePath);
});

test('resolveClaudeCodeExecutablePath keeps an explicitly configured command when PATH lookup fails', () => {
  const resolved = resolveClaudeCodeExecutablePath('claude', {
    platform: 'win32',
    pathEnvironment: '',
    existsSync: () => false,
  });

  assert.equal(resolved, 'claude');
});

test('resolveClaudeCodeExecutablePath returns undefined on Windows when the default resolves to nothing', () => {
  // The SDK spawns this path directly, so a bare `claude` would fail with
  // "native binary not found at claude"; undefined means "use your own binary".
  const resolved = resolveClaudeCodeExecutablePath(undefined, {
    platform: 'win32',
    pathEnvironment: '',
    existsSync: () => false,
  });

  assert.equal(resolved, undefined);
});

test('resolveClaudeCodeExecutablePath returns undefined when every wrapper on PATH is a JavaScript launcher', () => {
  // An older global install ships cli.js and no bin/claude.exe, so nothing on
  // PATH maps to a native binary the SDK can spawn.
  const wrapperDir = 'C:\\Users\\dev\\AppData\\Roaming\\npm';

  const resolved = resolveClaudeCodeExecutablePath(undefined, {
    platform: 'win32',
    pathEnvironment: wrapperDir,
    existsSync: existsOnly(`${wrapperDir}\\claude`, `${wrapperDir}\\claude.cmd`),
    readFileSync: readNpmShim,
  });

  assert.equal(resolved, undefined);
});

test('resolveClaudeCodeExecutablePath still resolves the native exe when both installs are on PATH', () => {
  const staleDir = 'C:\\Users\\dev\\AppData\\Roaming\\npm';
  const nativeDir = 'C:\\nvm4w\\nodejs';
  const nativePath = `${nativeDir}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;

  const resolved = resolveClaudeCodeExecutablePath(undefined, {
    platform: 'win32',
    pathEnvironment: `${staleDir};${nativeDir}`,
    existsSync: existsOnly(`${staleDir}\\claude`, `${nativeDir}\\claude`, nativePath),
    readFileSync: readNpmShim,
  });

  assert.equal(resolved, nativePath);
});

test('resolveClaudeCodeExecutablePath prefers a native exe on PATH over an earlier npm shim', () => {
  const shimDir = 'C:\\Users\\dev\\AppData\\Roaming\\npm';
  const nativeDir = 'C:\\Users\\星辰\\AppData\\Local\\Microsoft\\WinGet\\Link';
  const nativePath = `${nativeDir}\\claude.exe`;

  const resolved = resolveClaudeCodeExecutablePath(undefined, {
    platform: 'win32',
    pathEnvironment: `${shimDir};${nativeDir}`,
    existsSync: existsOnly(`${shimDir}\\claude`, nativePath),
    readFileSync: readNpmShim,
  });

  assert.equal(resolved, nativePath);
});

test('resolveClaudeCodeExecutablePath leaves non-Windows platforms on the bare command', () => {
  const resolved = resolveClaudeCodeExecutablePath(undefined, { platform: 'linux' });

  assert.equal(resolved, 'claude');
});
