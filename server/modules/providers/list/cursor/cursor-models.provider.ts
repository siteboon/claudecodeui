import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import crossSpawn from 'cross-spawn';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  sanitizeLeafDirectoryName,
} from '@/shared/utils.js';

export const CURSOR_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'auto', label: 'Auto' },
    { value: 'composer-2-fast', label: 'Composer 2 Fast' },
    { value: 'composer-2', label: 'Composer 2' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3' },
    { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
  ],
  DEFAULT: 'composer-2-fast',
};

type CursorModelRow = {
  name: string;
  description: string;
  current: boolean;
  default: boolean;
};

const CURSOR_MODELS_TIMEOUT_MS = 10_000;
const CURSOR_CHATS_ROOT = path.join(os.homedir(), '.cursor', 'chats');
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;
const ANSI_PATTERN = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const parseModelLine = (line: string): CursorModelRow | null => {
  const trimmed = line.trim();

  if (
    !trimmed
    || trimmed === 'Available models'
    || trimmed.startsWith('Loading models')
    || trimmed.startsWith('Tip:')
  ) {
    return null;
  }

  const match = trimmed.match(/^(.+?)\s+-\s+(.+)$/);
  if (!match) {
    return null;
  }

  const name = match[1].trim();
  let description = match[2].trim();
  const current = /\(current\)/i.test(description);
  const defaultModel = /\(default\)/i.test(description);

  description = description.replace(/\s*\((current|default)\)/gi, '').replace(/\s{2,}/g, ' ').trim();

  return {
    name,
    description,
    current,
    default: defaultModel,
  };
};

const parseModelsOutput = (text: string): CursorModelRow[] => {
  const models: CursorModelRow[] = [];

  for (const line of stripAnsi(text).split(/\r?\n/)) {
    const parsed = parseModelLine(line);
    if (parsed) {
      models.push(parsed);
    }
  }

  return models;
};

const runCursorListModels = (): Promise<string> => new Promise((resolve, reject) => {
  const cursorProcess = spawnFunction('cursor-agent', ['--list-models'], {
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    cursorProcess.kill('SIGTERM');
    if (!settled) {
      settled = true;
      reject(new Error('cursor-agent --list-models timed out'));
    }
  }, CURSOR_MODELS_TIMEOUT_MS);

  const finish = (error: Error | null, output: string) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);

    if (error) {
      reject(error);
      return;
    }

    resolve(output);
  };

  cursorProcess.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  cursorProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  cursorProcess.on('error', (error) => {
    finish(error instanceof Error ? error : new Error(String(error)), '');
  });

  cursorProcess.on('close', (code) => {
    if (code !== 0) {
      finish(new Error(stderr.trim() || `cursor-agent --list-models exited with code ${code}`), '');
      return;
    }

    finish(null, stdout);
  });
});

const buildCursorModelsDefinition = (models: CursorModelRow[]): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of models) {
    if (seenValues.has(model.name)) {
      continue;
    }

    seenValues.add(model.name);
    options.push({
      value: model.name,
      label: model.name,
      description: model.description || undefined,
    });
  }

  if (options.length === 0) {
    return CURSOR_FALLBACK_MODELS;
  }

  const defaultValue = models.find((model) => model.default)?.name
    ?? models.find((model) => model.current)?.name
    ?? options[0]?.value
    ?? CURSOR_FALLBACK_MODELS.DEFAULT;

  return {
    OPTIONS: options,
    DEFAULT: defaultValue,
  };
};

const resolveCursorSessionStorePath = async (sessionId: string): Promise<string | null> => {
  const safeSessionId = sanitizeLeafDirectoryName(sessionId, 'cursor session id');

  try {
    const workspaceEntries = await readdir(CURSOR_CHATS_ROOT, { withFileTypes: true });
    for (const workspaceEntry of workspaceEntries) {
      if (!workspaceEntry.isDirectory()) {
        continue;
      }

      const storeDbPath = path.join(CURSOR_CHATS_ROOT, workspaceEntry.name, safeSessionId, 'store.db');
      try {
        await access(storeDbPath);
        return storeDbPath;
      } catch {
        // Keep scanning sibling workspaces until the matching session directory is found.
      }
    }
  } catch {
    return null;
  }

  return null;
};

export class CursorProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const stdout = await runCursorListModels();
      const models = parseModelsOutput(stdout);
      return buildCursorModelsDefinition(models);
    } catch {
      return CURSOR_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const storeDbPath = await resolveCursorSessionStorePath(sessionId);
      if (!storeDbPath) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      const { default: Database } = await import('better-sqlite3');
      const db = new Database(storeDbPath, { readonly: true, fileMustExist: true });

      try {
        const row = db.prepare(`SELECT value FROM meta WHERE key='0' LIMIT 1;`).get() as {
          value?: Buffer | string;
        } | undefined;
        const metadataText = Buffer.isBuffer(row?.value)
          ? row.value.toString('utf8')
          : typeof row?.value === 'string' && row.value.trim()
            ? Buffer.from(row.value.trim(), 'hex').toString('utf8')
            : '';
        if (!metadataText) {
          return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
        }

        const metadata = JSON.parse(metadataText) as { lastUsedModel?: string };
        if (typeof metadata.lastUsedModel === 'string' && metadata.lastUsedModel.trim()) {
          return {
            model: metadata.lastUsedModel.trim(),
          };
        }
      } finally {
        db.close();
      }
    } catch {
      // Fall through to the provider default when Cursor metadata cannot be read.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
