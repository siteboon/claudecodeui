import { chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';
import { homeDataDir } from '@/modules/workbench-sessions/workbench-sessions.service.js';

/**
 * Claude Code status hooks. Hard rules: the user must confirm in the UI first, the existing
 * settings file is backed up, and our entries are merged in (never overwriting anything).
 * The script exits silently unless WORKBENCH_SESSION_ID is set, so normal Claude Code use
 * outside Workbench is unaffected. Hook commands run through a POSIX shell (Git Bash on
 * Windows, which Claude Code requires), so one sh script serves every platform.
 */
const MARKER = 'workbench/hooks/notify.sh';
const EVENTS = ['Notification', 'Stop', 'UserPromptSubmit'] as const;

export const HOOK_SCRIPT = `#!/bin/sh
# Workbench status hook. No-op outside Workbench sessions.
[ -n "$WORKBENCH_SESSION_ID" ] || exit 0
[ -n "$WORKBENCH_PORT" ] || exit 0
curl -s -m 2 -X POST \\
  -H "Content-Type: application/json" \\
  -H "X-Workbench-Token: $WORKBENCH_HOOK_TOKEN" \\
  -d "{\\"sessionId\\":\\"$WORKBENCH_SESSION_ID\\",\\"event\\":\\"$1\\"}" \\
  "http://127.0.0.1:$WORKBENCH_PORT/api/workbench/hooks" >/dev/null 2>&1
exit 0
`;

type HookEntry = { type: string; command: string };
type HookGroup = { matcher?: string; hooks: HookEntry[] };
type Settings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>;

export function claudeSettingsPath(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}

export function hookScriptPath(): string {
  return path.join(homeDataDir(), 'hooks', 'notify.sh');
}

/** Forward slashes keep the path valid in Git Bash on Windows. */
function commandFor(event: string): string {
  const script = hookScriptPath().split(path.sep).join('/');
  return `sh "${script}" ${event}`;
}

async function readSettings(file: string): Promise<{ settings: Settings; existed: boolean }> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppError('settings.json is not a JSON object — refusing to modify it', {
        code: 'SETTINGS_UNREADABLE',
        statusCode: 409,
      });
    }
    return { settings: parsed as Settings, existed: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { settings: {}, existed: false };
    throw new AppError('settings.json could not be parsed — refusing to modify it', {
      code: 'SETTINGS_UNREADABLE',
      statusCode: 409,
    });
  }
}

function isOurs(entry: HookEntry): boolean {
  return typeof entry?.command === 'string' && entry.command.includes(MARKER);
}

export async function getHooksStatus(): Promise<{ installed: boolean; settingsPath: string }> {
  const file = claudeSettingsPath();
  try {
    const { settings } = await readSettings(file);
    const installed = EVENTS.every((event) =>
      (settings.hooks?.[event] ?? []).some((group) => (group.hooks ?? []).some(isOurs)));
    return { installed, settingsPath: file };
  } catch {
    return { installed: false, settingsPath: file };
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.workbench-tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
}

export async function installClaudeHooks(confirm: boolean): Promise<{ backupPath: string | null; settingsPath: string }> {
  if (!confirm) {
    throw new AppError('Installing hooks modifies ~/.claude/settings.json and needs explicit confirmation', {
      code: 'CONFIRMATION_REQUIRED',
      statusCode: 400,
    });
  }
  const file = claudeSettingsPath();
  const { settings, existed } = await readSettings(file);

  await mkdir(path.dirname(hookScriptPath()), { recursive: true });
  await writeFile(hookScriptPath(), HOOK_SCRIPT, { encoding: 'utf8', mode: 0o755 });
  if (process.platform !== 'win32') await chmod(hookScriptPath(), 0o755);

  let backupPath: string | null = null;
  if (existed) {
    backupPath = `${file}.workbench-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(file, backupPath);
  } else {
    await mkdir(path.dirname(file), { recursive: true });
  }

  const hooks = { ...(settings.hooks ?? {}) };
  for (const event of EVENTS) {
    const groups = [...(hooks[event] ?? [])];
    const already = groups.some((group) => (group.hooks ?? []).some(isOurs));
    if (!already) {
      groups.push({ hooks: [{ type: 'command', command: commandFor(event) }] });
    }
    hooks[event] = groups;
  }
  await writeAtomic(file, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`);
  return { backupPath, settingsPath: file };
}

export async function uninstallClaudeHooks(confirm: boolean): Promise<{ backupPath: string | null }> {
  if (!confirm) {
    throw new AppError('Removing hooks modifies ~/.claude/settings.json and needs explicit confirmation', {
      code: 'CONFIRMATION_REQUIRED',
      statusCode: 400,
    });
  }
  const file = claudeSettingsPath();
  const { settings, existed } = await readSettings(file);
  if (!existed) return { backupPath: null };
  const backupPath = `${file}.workbench-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copyFile(file, backupPath);
  const hooks: Record<string, HookGroup[]> = { ...(settings.hooks ?? {}) };
  for (const event of Object.keys(hooks)) {
    const groups = (hooks[event] ?? [])
      .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((entry) => !isOurs(entry)) }))
      .filter((group) => group.hooks.length > 0);
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  const next: Settings = { ...settings };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return { backupPath };
}
