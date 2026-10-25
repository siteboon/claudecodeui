import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';
import { homeDataDir } from '@/modules/workbench-sessions/workbench-sessions.service.js';

/**
 * Status hooks for Claude Code and Codex. Hard rules: the user must confirm in the UI first,
 * the existing file is backed up, and our entries are merged in (never overwriting anything).
 *
 * Both CLIs use the same shape (`hooks.<Event>[].hooks[].command`), but run the command through
 * different shells (Git Bash, PowerShell, ...), so the command is `node "<script>" <Event>`:
 * valid in every shell. The script exits silently unless WORKBENCH_SESSION_ID is set, so normal
 * CLI use outside Workbench is unaffected.
 */
const MARKER = 'workbench-notify.mjs';

export type HookAgent = 'claude' | 'codex';

const EVENTS: Record<HookAgent, readonly string[]> = {
  claude: ['Notification', 'Stop', 'UserPromptSubmit'],
  // Codex has PermissionRequest (about to ask for approval) instead of Notification.
  codex: ['PermissionRequest', 'Stop', 'UserPromptSubmit'],
};

export const HOOK_SCRIPT = `// Workbench status hook. No-op outside Workbench sessions.
const { WORKBENCH_SESSION_ID: sessionId, WORKBENCH_PORT: port, WORKBENCH_HOOK_TOKEN: token } = process.env;
const event = process.argv[2];
if (!sessionId || !port || !event) process.exit(0);
// The CLI writes the hook payload to stdin; it is not needed, so just drain it.
process.stdin.resume();
process.stdin.on('data', () => {});
fetch(\`http://127.0.0.1:\${port}/api/workbench/hooks\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': token ?? '' },
  body: JSON.stringify({ sessionId, event }),
  signal: AbortSignal.timeout(2000),
}).catch(() => {}).finally(() => process.exit(0));
`;

type HookEntry = { type: string; command: string };
type HookGroup = { matcher?: string; hooks: HookEntry[] };
type Settings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>;

export function claudeSettingsPath(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}

/** Codex reads inline `[hooks]` from config.toml or `hooks.json`; we only touch hooks.json (no TOML rewrite). */
export function codexHooksPath(): string {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json');
}

export function hooksFilePath(agent: HookAgent): string {
  return agent === 'codex' ? codexHooksPath() : claudeSettingsPath();
}

export function hookScriptPath(): string {
  return path.join(homeDataDir(), 'hooks', MARKER);
}

/** Forward slashes are valid in every shell on Windows too. */
function commandFor(event: string): string {
  return `node "${hookScriptPath().split(path.sep).join('/')}" ${event}`;
}

async function readSettings(file: string): Promise<{ settings: Settings; existed: boolean }> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppError(`${path.basename(file)} is not a JSON object — refusing to modify it`, {
        code: 'SETTINGS_UNREADABLE',
        statusCode: 409,
      });
    }
    return { settings: parsed as Settings, existed: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { settings: {}, existed: false };
    throw new AppError(`${path.basename(file)} could not be parsed — refusing to modify it`, {
      code: 'SETTINGS_UNREADABLE',
      statusCode: 409,
    });
  }
}

function isOurs(entry: HookEntry): boolean {
  return typeof entry?.command === 'string' && entry.command.includes(MARKER);
}

async function statusFor(agent: HookAgent): Promise<{ installed: boolean; settingsPath: string }> {
  const file = hooksFilePath(agent);
  try {
    const { settings } = await readSettings(file);
    const installed = EVENTS[agent].every((event) =>
      (settings.hooks?.[event] ?? []).some((group) => (group.hooks ?? []).some(isOurs)));
    return { installed, settingsPath: file };
  } catch {
    return { installed: false, settingsPath: file };
  }
}

/** Top-level `installed`/`settingsPath` describe Claude (the original shape); `agents` has both. */
export async function getHooksStatus(): Promise<{
  installed: boolean;
  settingsPath: string;
  agents: Record<HookAgent, { installed: boolean; settingsPath: string }>;
}> {
  const [claude, codex] = await Promise.all([statusFor('claude'), statusFor('codex')]);
  return { ...claude, agents: { claude, codex } };
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.workbench-tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
}

function backupName(file: string): string {
  return `${file}.workbench-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

export async function installHooks(
  agent: HookAgent,
  confirm: boolean,
): Promise<{ backupPath: string | null; settingsPath: string }> {
  const file = hooksFilePath(agent);
  if (!confirm) {
    throw new AppError(`Installing hooks modifies ${file} and needs explicit confirmation`, {
      code: 'CONFIRMATION_REQUIRED',
      statusCode: 400,
    });
  }
  const { settings, existed } = await readSettings(file);

  await mkdir(path.dirname(hookScriptPath()), { recursive: true });
  await writeFile(hookScriptPath(), HOOK_SCRIPT, 'utf8');

  let backupPath: string | null = null;
  if (existed) {
    backupPath = backupName(file);
    await copyFile(file, backupPath);
  } else {
    await mkdir(path.dirname(file), { recursive: true });
  }

  const hooks = { ...(settings.hooks ?? {}) };
  for (const event of EVENTS[agent]) {
    const groups = [...(hooks[event] ?? [])];
    if (!groups.some((group) => (group.hooks ?? []).some(isOurs))) {
      groups.push({ hooks: [{ type: 'command', command: commandFor(event) }] });
    }
    hooks[event] = groups;
  }
  await writeAtomic(file, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`);
  return { backupPath, settingsPath: file };
}

export async function uninstallHooks(agent: HookAgent, confirm: boolean): Promise<{ backupPath: string | null }> {
  const file = hooksFilePath(agent);
  if (!confirm) {
    throw new AppError(`Removing hooks modifies ${file} and needs explicit confirmation`, {
      code: 'CONFIRMATION_REQUIRED',
      statusCode: 400,
    });
  }
  const { settings, existed } = await readSettings(file);
  if (!existed) return { backupPath: null };
  const backupPath = backupName(file);
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

export const installClaudeHooks = (confirm: boolean) => installHooks('claude', confirm);
export const uninstallClaudeHooks = (confirm: boolean) => uninstallHooks('claude', confirm);
