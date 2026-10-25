import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * Apps launched from Finder/Dock do not inherit the login-shell PATH, so `claude`,
 * `codex`, `git` and `code` would not be found. Read the login-shell environment once
 * and merge its PATH into process.env. Must run before any CLI or git process spawns.
 */
export async function fixPath() {
  if (process.platform === 'win32') return;

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const loginPath = await new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', 'printf "__WB_PATH__%s__WB_END__" "$PATH"'],
      { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (error, stdout) => {
        if (error && !stdout) return resolve(null);
        const match = /__WB_PATH__(.*?)__WB_END__/s.exec(String(stdout));
        resolve(match ? match[1] : null);
      },
    );
  });

  const fallback = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
  ];
  const parts = [
    ...(loginPath ? loginPath.split(path.delimiter) : []),
    ...(process.env.PATH || '').split(path.delimiter),
    ...fallback,
  ].filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(path.delimiter);
}
