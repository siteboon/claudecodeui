import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

// Shared by the conversation-search ripgrep tests. Each test file pins one
// @vscode/ripgrep install layout for its whole process (the service memoizes
// the binary it picks), so the layouts live in separate files that share these
// fixtures. This file holds no tests.

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

/**
 * Writes an `rg` stand-in into `binDir` that supports the `--files-with-matches`
 * call the search service makes and appends every invocation's arguments to
 * `logPath`. The executable is `rg` (`rg.cmd` on Windows).
 *
 * Used by session-conversations-search-ripgrep.test.ts (rg on PATH) and
 * session-conversations-search-bundled-ripgrep.test.ts (bundled binary and rg on PATH).
 */
export async function createFakeRipgrepExecutable(binDir: string, logPath: string): Promise<void> {
  const scriptPath = path.join(binDir, 'rg.cjs');
  await writeFile(scriptPath, `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n');
const [pattern, ...files] = args.slice(args.indexOf('--') + 1);
const matches = files.filter((file) =>
  fs.readFileSync(file, 'utf8').toLowerCase().includes(pattern.toLowerCase()));
if (matches.length > 0) {
  process.stdout.write(matches.join('\\n') + '\\n');
}
process.exitCode = matches.length > 0 ? 0 : 1;
`, 'utf8');

  if (process.platform === 'win32') {
    await writeFile(
      path.join(binDir, 'rg.cmd'),
      `@echo off\r\n"${process.execPath}" "%~dp0rg.cjs" %*\r\n`,
      'utf8',
    );
    return;
  }

  const commandPath = path.join(binDir, 'rg');
  // Absolute paths only: PATH holds nothing but `binDir`, so `dirname` and
  // `node` would not resolve inside the wrapper.
  await writeFile(commandPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, 'utf8');
  await chmod(commandPath, 0o755);
}

/**
 * Returns the search pattern of every invocation a fake `rg` from
 * createFakeRipgrepExecutable logged to `logPath`, in call order; empty when
 * that executable never ran.
 *
 * Used by both conversation-search ripgrep test files to tell which ripgrep
 * executable ran and for which query words.
 */
export async function readRipgrepSearchPatterns(logPath: string): Promise<string[]> {
  if (!existsSync(logPath)) {
    return [];
  }

  return (await readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => {
      const args = JSON.parse(line) as string[];
      return args[args.indexOf('--') + 1];
    });
}

/**
 * Runs `run` against a fresh database holding one Codex session whose title and
 * transcript both mention "release planning", with PATH set to `binDir` only.
 *
 * Used by both conversation-search ripgrep test files to drive searchConversations
 * end to end.
 */
export async function withSearchFixture(
  run: (paths: { binDir: string; tempDirectory: string }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const pathKey = findEnvKey('PATH');
  const previousPath = process.env[pathKey];
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'conversation-search-ripgrep-'));
  const binDir = path.join(tempDirectory, 'bin');
  const workspacePath = path.join(tempDirectory, 'workspace');
  await mkdir(binDir);
  await mkdir(workspacePath);

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();

  const transcriptPath = path.join(tempDirectory, 'codex-search.jsonl');
  await writeFile(transcriptPath, `${JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-10-04T09:00:00.000Z',
    payload: {
      type: 'user_message',
      kind: 'plain',
      message: 'Release planning happens on Termux too.',
    },
  })}\n`);
  sessionsDb.createSession(
    'transcript-session',
    'codex',
    workspacePath,
    'Release planning notes',
    undefined,
    undefined,
    transcriptPath,
  );

  try {
    process.env[pathKey] = binDir;
    await run({ binDir, tempDirectory });
  } finally {
    process.env[pathKey] = previousPath;
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
