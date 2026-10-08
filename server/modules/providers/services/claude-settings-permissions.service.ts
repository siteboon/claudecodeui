import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readObjectRecord, readStringArray } from '@/shared/utils.js';

/**
 * The permission rules one Claude settings file contributes.
 *
 * `status` says whether the rules could be read at all: `missing` means there
 * is no such file, `invalid` means it exists but the CLI would not load it
 * either (unreadable, over its size cap, or not a JSON object). Both report
 * empty rule lists rather than failing the request, so one bad file never hides
 * the others.
 */
type ClaudeSettingsPermissionSource = {
  scope: 'user' | 'managed';
  path: string;
  status: 'ok' | 'missing' | 'invalid';
  allow: string[];
  deny: string[];
  ask: string[];
};

/**
 * The user's own settings file. The CLI reads it from `CLAUDE_CONFIG_DIR` when
 * that is set, and the server forwards its whole env to every CLI it spawns,
 * so the same override has to apply here.
 */
const userSettingsPath = (): string => {
  const configDirectory = process.env.CLAUDE_CONFIG_DIR?.trim();
  const baseDirectory = configDirectory && path.isAbsolute(configDirectory)
    ? configDirectory
    : path.join(os.homedir(), '.claude');
  return path.join(baseDirectory, 'settings.json');
};

/** The administrator-managed settings file, at the fixed path the CLI uses per OS. */
const managedSettingsPath = (): string => {
  if (process.platform === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-settings.json';
  }
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  }
  return '/etc/claude-code/managed-settings.json';
};

// The CLI refuses to load a settings file larger than this (2 MB).
const MAX_SETTINGS_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Decodes a settings file the way the CLI does: UTF-16LE when it starts with
 * that byte order mark, UTF-8 otherwise, without the leading BOM. Windows
 * editors and PowerShell often save one, and the CLI still applies such files.
 */
const decodeSettingsFile = (bytes: Buffer): string => {
  const isUtf16LittleEndian = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  return bytes.toString(isUtf16LittleEndian ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
};

/** Keeps non-empty string rules only, without duplicates, in file order. */
const readRuleList = (value: unknown): string[] => [
  ...new Set((readStringArray(value) ?? []).map((rule) => rule.trim()).filter(Boolean)),
];

async function readPermissionSource(
  scope: ClaudeSettingsPermissionSource['scope'],
  filePath: string,
): Promise<ClaudeSettingsPermissionSource> {
  const empty = { scope, path: filePath, allow: [], deny: [], ask: [] };

  let content: string;
  try {
    if ((await stat(filePath)).size > MAX_SETTINGS_FILE_BYTES) {
      return { ...empty, status: 'invalid' };
    }
    content = decodeSettingsFile(await readFile(filePath));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ...empty, status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'invalid' };
  }

  // The CLI loads an empty or whitespace-only file as `{}`.
  if (!content.trim()) {
    return { ...empty, status: 'ok' };
  }

  let settings: Record<string, unknown> | null;
  try {
    settings = readObjectRecord(JSON.parse(content));
  } catch {
    settings = null;
  }
  if (!settings) {
    return { ...empty, status: 'invalid' };
  }

  // A file without a `permissions` block is perfectly valid; it just adds no rules.
  const permissions = readObjectRecord(settings.permissions) ?? {};
  return {
    ...empty,
    status: 'ok',
    allow: readRuleList(permissions.allow),
    deny: readRuleList(permissions.deny),
    ask: readRuleList(permissions.ask),
  };
}

/**
 * Read-only view of the permission rules the Claude CLI applies from its own
 * settings files, on top of the allowed/blocked lists CloudCLI passes it.
 *
 * Used by provider.routes.ts for the Claude permissions panel in Settings.
 * Project-level files are left out on purpose: the panel has no project, and
 * those files only apply to chats started inside their project. CloudCLI never
 * writes to any of these files.
 */
export const claudeSettingsPermissionsService = {
  /** `managedPath` is only overridden by tests, which cannot write to the system path. */
  async listRuleSources(managedPath: string = managedSettingsPath()): Promise<ClaudeSettingsPermissionSource[]> {
    return Promise.all([
      readPermissionSource('user', userSettingsPath()),
      readPermissionSource('managed', managedPath),
    ]);
  },
};
