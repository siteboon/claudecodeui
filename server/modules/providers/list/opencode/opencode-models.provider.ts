import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';

import crossSpawn from 'cross-spawn';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  getOpenCodeDatabasePath,
  readObjectRecord,
  readOptionalString,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const OPENCODE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { value: 'anthropic/claude-opus-4-1', label: 'Claude Opus 4.1' },
    { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { value: 'openai/gpt-5.1', label: 'GPT-5.1' },
    { value: 'openai/gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    { value: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  DEFAULT: 'anthropic/claude-sonnet-4-5',
};

const OPEN_CODE_MODELS_TIMEOUT_MS = 20_000;
const MODEL_ID_LINE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

const parseOpenCodeModelsStdout = (stdout: string): string[] => {
  const ids: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('{') || line.startsWith('[')) {
      continue;
    }

    if (MODEL_ID_LINE.test(line)) {
      ids.push(line);
    }
  }

  return [...new Set(ids)];
};

const labelForOpenCodeModelId = (id: string): string => {
  const fallbackLabel = OPENCODE_FALLBACK_MODELS.OPTIONS.find((option) => option.value === id)?.label;
  if (fallbackLabel) {
    return fallbackLabel;
  }

  const tail = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
  return tail.replace(/-/g, ' ');
};

const buildOpenCodeDefinitionFromIds = (ids: string[]): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = ids.map((value) => ({
    value,
    label: labelForOpenCodeModelId(value),
  }));

  const defaultValue = options.find((option) => option.value === OPENCODE_FALLBACK_MODELS.DEFAULT)?.value
    ?? options[0]?.value
    ?? OPENCODE_FALLBACK_MODELS.DEFAULT;

  return {
    OPTIONS: options,
    DEFAULT: defaultValue,
  };
};

const parseOpenCodeSessionModelValue = (rawModel: unknown): string | null => {
  if (typeof rawModel === 'string') {
    const trimmed = rawModel.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return parseOpenCodeSessionModelValue(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }

  const record = readObjectRecord(rawModel);
  if (!record) {
    return null;
  }

  return readOptionalString(record.id)
    ?? readOptionalString(record.model)
    ?? readOptionalString(record.name)
    ?? readOptionalString(record.value)
    ?? null;
};

const runOpenCodeModelsCommand = (): Promise<string> => new Promise((resolve, reject) => {
  const openCodeProcess = spawnFunction('opencode', ['models'], {
    cwd: process.cwd(),
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    openCodeProcess.kill('SIGTERM');
    if (!settled) {
      settled = true;
      reject(new Error('opencode models timed out'));
    }
  }, OPEN_CODE_MODELS_TIMEOUT_MS);

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

  openCodeProcess.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  openCodeProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  openCodeProcess.on('error', (error) => {
    finish(error instanceof Error ? error : new Error(String(error)), '');
  });

  openCodeProcess.on('close', (code) => {
    if (code !== 0) {
      finish(new Error(stderr.trim() || `opencode models exited with code ${code}`), '');
      return;
    }

    finish(null, stdout);
  });
});

export class OpenCodeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const stdout = await runOpenCodeModelsCommand();
      const ids = parseOpenCodeModelsStdout(stdout);
      if (ids.length === 0) {
        return OPENCODE_FALLBACK_MODELS;
      }

      return buildOpenCodeDefinitionFromIds(ids);
    } catch {
      return OPENCODE_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const dbPath = getOpenCodeDatabasePath();
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });

      try {
        const row = db.prepare(`
          SELECT
            s.id AS sessionId,
            s.model AS model,
            s.agent AS agent,
            s.directory AS directory,
            s.time_updated AS timeUpdated,
            s.time_created AS timeCreated
          FROM session s
          WHERE s.id = ?
          ORDER BY COALESCE(s.time_updated, s.time_created, 0) DESC
          LIMIT 1
        `).get(sessionId) as {
          sessionId?: string;
          model?: unknown;
          agent?: string | null;
          directory?: string | null;
          timeUpdated?: number | null;
          timeCreated?: number | null;
        } | undefined;

        const model = parseOpenCodeSessionModelValue(row?.model);
        if (model) {
          return {
            model,
          };
        }
      } finally {
        db.close();
      }
    } catch {
      // Fall through to the provider default when OpenCode session lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('opencode', input);
  }
}
