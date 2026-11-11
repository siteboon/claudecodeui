import { constants as fsConstants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  readObjectRecord,
  readOptionalString,
  stripJsonComments,
  stripTrailingCommas,
} from '@/shared/utils.js';

/** Global OpenCode config files, in the order the CLI loads them. */
const OPENCODE_CONFIG_FILES = ['config.json', 'opencode.json', 'opencode.jsonc'];

/** v1 declares providers under `provider`, v2 under `providers`. */
const PROVIDER_SECTION_KEYS = ['provider', 'providers'];

/** v2 keeps the key in `settings`, v1 in `options`. */
const API_KEY_SECTION_KEYS = ['settings', 'options'];

const WHOLE_ENV_TOKEN = /^\{env:([^}]+)\}$/;
const WHOLE_FILE_TOKEN = /^\{file:([^}]+)\}$/;

export type OpenCodeConfigSource = {
  config: Record<string, unknown>;
  /** Directory relative `{file:}` paths resolve against; null for inline config. */
  sourceDir: string | null;
};

export type OpenCodeFileCredential = { kind: 'file'; path: string; sourceDir: string | null };

/** What a provider's `apiKey` points at. The key itself is never carried. */
export type OpenCodeCredential =
  | { kind: 'none' }
  | { kind: 'literal' }
  | { kind: 'env'; name: string }
  | OpenCodeFileCredential;

export type OpenCodeConfiguredProvider = { id: string; credential: OpenCodeCredential };

const NO_CREDENTIAL: OpenCodeCredential = { kind: 'none' };

/** OpenCode accepts JSONC in its config files and inline config. */
const parseOpenCodeJsonc = (content: string): Record<string, unknown> | null => {
  try {
    return readObjectRecord(JSON.parse(stripTrailingCommas(stripJsonComments(content))));
  } catch {
    return null;
  }
};

const readConfigFile = async (
  filePath: string,
): Promise<OpenCodeConfigSource | null> => {
  try {
    const config = parseOpenCodeJsonc(await readFile(filePath, 'utf8'));
    return config ? { config, sourceDir: path.dirname(filePath) } : null;
  } catch {
    // A missing or unreadable file contributes nothing.
    return null;
  }
};

/**
 * OpenCode's global config directory: `OPENCODE_CONFIG_DIR` when set,
 * otherwise `opencode` under `XDG_CONFIG_HOME`, falling back to `~/.config`.
 */
export const getOpenCodeConfigDir = (): string => {
  const overrideDir = readOptionalString(process.env.OPENCODE_CONFIG_DIR);
  if (overrideDir) {
    return path.resolve(overrideDir);
  }

  const configHome = readOptionalString(process.env.XDG_CONFIG_HOME) ?? path.join(os.homedir(), '.config');
  return path.join(configHome, 'opencode');
};

/**
 * Reads the global config files, `OPENCODE_CONFIG` (a file path) and
 * `OPENCODE_CONFIG_CONTENT` (inline config). Malformed or unreadable sources
 * are skipped rather than failing the caller.
 */
export const readOpenCodeConfigs = async (): Promise<OpenCodeConfigSource[]> => {
  const configDir = getOpenCodeConfigDir();
  const filePaths = OPENCODE_CONFIG_FILES.map((fileName) => path.join(configDir, fileName));

  const customConfigPath = readOptionalString(process.env.OPENCODE_CONFIG);
  if (customConfigPath) {
    filePaths.push(path.resolve(customConfigPath));
  }

  const sources: OpenCodeConfigSource[] = [];
  for (const filePath of filePaths) {
    const source = await readConfigFile(filePath);
    if (source) {
      sources.push(source);
    }
  }

  const inlineConfig = readOptionalString(process.env.OPENCODE_CONFIG_CONTENT);
  const config = inlineConfig ? parseOpenCodeJsonc(inlineConfig) : null;
  if (config) {
    sources.push({ config, sourceDir: null });
  }

  return sources;
};

/**
 * Classifies an `apiKey` value. Only a whole-value token is resolvable here;
 * a token inside a longer string depends on substitution this cannot verify,
 * so it fails closed.
 */
const classifyApiKey = (value: unknown, sourceDir: string | null): OpenCodeCredential => {
  if (typeof value !== 'string') {
    return NO_CREDENTIAL;
  }

  const trimmed = value.trim();
  const envMatch = WHOLE_ENV_TOKEN.exec(trimmed);
  if (envMatch) {
    return { kind: 'env', name: envMatch[1] };
  }

  const fileMatch = WHOLE_FILE_TOKEN.exec(trimmed);
  if (fileMatch) {
    return { kind: 'file', path: fileMatch[1], sourceDir };
  }

  if (!trimmed || trimmed.includes('{env:') || trimmed.includes('{file:')) {
    return NO_CREDENTIAL;
  }

  return { kind: 'literal' };
};

const readProviderCredential = (entry: unknown, sourceDir: string | null): OpenCodeCredential => {
  const providerRecord = readObjectRecord(entry);
  for (const sectionKey of API_KEY_SECTION_KEYS) {
    const section = readObjectRecord(providerRecord?.[sectionKey]);
    const credential = classifyApiKey(section?.apiKey, sourceDir);
    if (credential.kind !== 'none') {
      return credential;
    }
  }

  return NO_CREDENTIAL;
};

/**
 * Lists every provider the configs declare, under either shape, with what its
 * `apiKey` points at. A provider declared in several places appears once per
 * declaration.
 */
export const listConfiguredProviders = (
  configs: OpenCodeConfigSource[],
): OpenCodeConfiguredProvider[] => {
  const providers: OpenCodeConfiguredProvider[] = [];
  for (const { config, sourceDir } of configs) {
    for (const sectionKey of PROVIDER_SECTION_KEYS) {
      for (const [id, entry] of Object.entries(readObjectRecord(config[sectionKey]) ?? {})) {
        providers.push({ id, credential: readProviderCredential(entry, sourceDir) });
      }
    }
  }

  return providers;
};

/**
 * Resolves a `{file:}` path: `~` is the home directory, and a relative path
 * belongs to the config file that holds it. Inline config has no such file,
 * so a relative path there resolves to nothing.
 */
const resolveCredentialFilePath = ({ path: filePath, sourceDir }: OpenCodeFileCredential): string | null => {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return sourceDir ? path.resolve(sourceDir, filePath) : null;
};

/**
 * Whether a `{file:}` key file is present: a readable, non-empty regular file.
 * It is checked with `stat` and `access` only and never opened, so the key
 * stays out of this process.
 */
export const hasFileCredential = async (credential: OpenCodeFileCredential): Promise<boolean> => {
  const resolvedPath = resolveCredentialFilePath(credential);
  if (!resolvedPath) {
    return false;
  }

  try {
    const stats = await stat(resolvedPath);
    if (!stats.isFile() || stats.size <= 0) {
      return false;
    }

    await access(resolvedPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
};
