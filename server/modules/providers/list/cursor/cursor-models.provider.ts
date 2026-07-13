import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  sanitizeLeafDirectoryName,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const CURSOR_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: "auto",
      label: "auto",
      description: "Auto",
    },
    {
      value: "composer-2-fast",
      label: "composer-2-fast",
      description: "Composer 2 Fast",
    },
    {
      value: "composer-2",
      label: "composer-2",
      description: "Composer 2",
    },
    {
      value: "gpt-5.3-codex-low",
      label: "gpt-5.3-codex-low",
      description: "Codex 5.3 Low",
    },
    {
      value: "gpt-5.3-codex-low-fast",
      label: "gpt-5.3-codex-low-fast",
      description: "Codex 5.3 Low Fast",
    },
    {
      value: "gpt-5.3-codex",
      label: "gpt-5.3-codex",
      description: "Codex 5.3",
    },
    {
      value: "gpt-5.3-codex-fast",
      label: "gpt-5.3-codex-fast",
      description: "Codex 5.3 Fast",
    },
    {
      value: "gpt-5.3-codex-high",
      label: "gpt-5.3-codex-high",
      description: "Codex 5.3 High",
    },
    {
      value: "gpt-5.3-codex-high-fast",
      label: "gpt-5.3-codex-high-fast",
      description: "Codex 5.3 High Fast",
    },
    {
      value: "gpt-5.3-codex-xhigh",
      label: "gpt-5.3-codex-xhigh",
      description: "Codex 5.3 Extra High",
    },
    {
      value: "gpt-5.3-codex-xhigh-fast",
      label: "gpt-5.3-codex-xhigh-fast",
      description: "Codex 5.3 Extra High Fast",
    },
    {
      value: "gpt-5.2",
      label: "gpt-5.2",
      description: "GPT-5.2",
    },
    {
      value: "gpt-5.2-codex-low",
      label: "gpt-5.2-codex-low",
      description: "Codex 5.2 Low",
    },
    {
      value: "gpt-5.2-codex-low-fast",
      label: "gpt-5.2-codex-low-fast",
      description: "Codex 5.2 Low Fast",
    },
    {
      value: "gpt-5.2-codex",
      label: "gpt-5.2-codex",
      description: "Codex 5.2",
    },
    {
      value: "gpt-5.2-codex-fast",
      label: "gpt-5.2-codex-fast",
      description: "Codex 5.2 Fast",
    },
    {
      value: "gpt-5.2-codex-high",
      label: "gpt-5.2-codex-high",
      description: "Codex 5.2 High",
    },
    {
      value: "gpt-5.2-codex-high-fast",
      label: "gpt-5.2-codex-high-fast",
      description: "Codex 5.2 High Fast",
    },
    {
      value: "gpt-5.2-codex-xhigh",
      label: "gpt-5.2-codex-xhigh",
      description: "Codex 5.2 Extra High",
    },
    {
      value: "gpt-5.2-codex-xhigh-fast",
      label: "gpt-5.2-codex-xhigh-fast",
      description: "Codex 5.2 Extra High Fast",
    },
    {
      value: "gpt-5.1-codex-max-low",
      label: "gpt-5.1-codex-max-low",
      description: "Codex 5.1 Max Low",
    },
    {
      value: "gpt-5.1-codex-max-low-fast",
      label: "gpt-5.1-codex-max-low-fast",
      description: "Codex 5.1 Max Low Fast",
    },
    {
      value: "gpt-5.1-codex-max-medium",
      label: "gpt-5.1-codex-max-medium",
      description: "Codex 5.1 Max",
    },
    {
      value: "gpt-5.1-codex-max-medium-fast",
      label: "gpt-5.1-codex-max-medium-fast",
      description: "Codex 5.1 Max Medium Fast",
    },
    {
      value: "gpt-5.1-codex-max-high",
      label: "gpt-5.1-codex-max-high",
      description: "Codex 5.1 Max High",
    },
    {
      value: "gpt-5.1-codex-max-high-fast",
      label: "gpt-5.1-codex-max-high-fast",
      description: "Codex 5.1 Max High Fast",
    },
    {
      value: "gpt-5.1-codex-max-xhigh",
      label: "gpt-5.1-codex-max-xhigh",
      description: "Codex 5.1 Max Extra High",
    },
    {
      value: "gpt-5.1-codex-max-xhigh-fast",
      label: "gpt-5.1-codex-max-xhigh-fast",
      description: "Codex 5.1 Max Extra High Fast",
    },
    {
      value: "composer-2.5",
      label: "composer-2.5",
      description: "Composer 2.5",
    },
    {
      value: "gpt-5.5-high",
      label: "gpt-5.5-high",
      description: "GPT-5.5 1M High",
    },
    {
      value: "gpt-5.5-high-fast",
      label: "gpt-5.5-high-fast",
      description: "GPT-5.5 High Fast",
    },
    {
      value: "claude-opus-4-7-thinking-high",
      label: "claude-opus-4-7-thinking-high",
      description: "Opus 4.7 1M High Thinking",
    },
    {
      value: "gpt-5.4-high",
      label: "gpt-5.4-high",
      description: "GPT-5.4 1M High",
    },
    {
      value: "gpt-5.4-high-fast",
      label: "gpt-5.4-high-fast",
      description: "GPT-5.4 High Fast",
    },
    {
      value: "claude-4.6-opus-high-thinking",
      label: "claude-4.6-opus-high-thinking",
      description: "Opus 4.6 1M Thinking",
    },
    {
      value: "claude-4.6-opus-high-thinking-fast",
      label: "claude-4.6-opus-high-thinking-fast",
      description: "Opus 4.6 1M Thinking Fast",
    },
    {
      value: "composer-2.5-fast",
      label: "composer-2.5-fast",
      description: "Composer 2.5 Fast",
    },
    {
      value: "gpt-5.5-none",
      label: "gpt-5.5-none",
      description: "GPT-5.5 1M None",
    },
    {
      value: "gpt-5.5-none-fast",
      label: "gpt-5.5-none-fast",
      description: "GPT-5.5 None Fast",
    },
    {
      value: "gpt-5.5-low",
      label: "gpt-5.5-low",
      description: "GPT-5.5 1M Low",
    },
    {
      value: "gpt-5.5-low-fast",
      label: "gpt-5.5-low-fast",
      description: "GPT-5.5 Low Fast",
    },
    {
      value: "gpt-5.5-medium",
      label: "gpt-5.5-medium",
      description: "GPT-5.5 1M",
    },
    {
      value: "gpt-5.5-medium-fast",
      label: "gpt-5.5-medium-fast",
      description: "GPT-5.5 Fast",
    },
    {
      value: "gpt-5.5-extra-high",
      label: "gpt-5.5-extra-high",
      description: "GPT-5.5 1M Extra High",
    },
    {
      value: "gpt-5.5-extra-high-fast",
      label: "gpt-5.5-extra-high-fast",
      description: "GPT-5.5 Extra High Fast",
    },
    {
      value: "claude-4.6-sonnet-medium",
      label: "claude-4.6-sonnet-medium",
      description: "Sonnet 4.6 1M",
    },
    {
      value: "claude-4.6-sonnet-medium-thinking",
      label: "claude-4.6-sonnet-medium-thinking",
      description: "Sonnet 4.6 1M Thinking",
    },
    {
      value: "claude-opus-4-7-low",
      label: "claude-opus-4-7-low",
      description: "Opus 4.7 1M Low",
    },
    {
      value: "claude-opus-4-7-low-fast",
      label: "claude-opus-4-7-low-fast",
      description: "Opus 4.7 1M Low Fast",
    },
    {
      value: "claude-opus-4-7-medium",
      label: "claude-opus-4-7-medium",
      description: "Opus 4.7 1M Medium",
    },
    {
      value: "claude-opus-4-7-medium-fast",
      label: "claude-opus-4-7-medium-fast",
      description: "Opus 4.7 1M Medium Fast",
    },
    {
      value: "claude-opus-4-7-high",
      label: "claude-opus-4-7-high",
      description: "Opus 4.7 1M High",
    },
    {
      value: "claude-opus-4-7-high-fast",
      label: "claude-opus-4-7-high-fast",
      description: "Opus 4.7 1M High Fast",
    },
    {
      value: "claude-opus-4-7-xhigh",
      label: "claude-opus-4-7-xhigh",
      description: "Opus 4.7 1M",
    },
    {
      value: "claude-opus-4-7-xhigh-fast",
      label: "claude-opus-4-7-xhigh-fast",
      description: "Opus 4.7 1M Fast",
    },
    {
      value: "claude-opus-4-7-max",
      label: "claude-opus-4-7-max",
      description: "Opus 4.7 1M Max",
    },
    {
      value: "claude-opus-4-7-max-fast",
      label: "claude-opus-4-7-max-fast",
      description: "Opus 4.7 1M Max Fast",
    },
    {
      value: "claude-opus-4-7-thinking-low",
      label: "claude-opus-4-7-thinking-low",
      description: "Opus 4.7 1M Low Thinking",
    },
    {
      value: "claude-opus-4-7-thinking-low-fast",
      label: "claude-opus-4-7-thinking-low-fast",
      description: "Opus 4.7 1M Low Thinking Fast",
    },
    {
      value: "claude-opus-4-7-thinking-medium",
      label: "claude-opus-4-7-thinking-medium",
      description: "Opus 4.7 1M Medium Thinking",
    },
    {
      value: "claude-opus-4-7-thinking-medium-fast",
      label: "claude-opus-4-7-thinking-medium-fast",
      description: "Opus 4.7 1M Medium Thinking Fast",
    },
    {
      value: "claude-opus-4-7-thinking-high-fast",
      label: "claude-opus-4-7-thinking-high-fast",
      description: "Opus 4.7 1M High Thinking Fast",
    },
    {
      value: "claude-opus-4-7-thinking-xhigh",
      label: "claude-opus-4-7-thinking-xhigh",
      description: "Opus 4.7 1M Thinking",
    },
    {
      value: "claude-opus-4-7-thinking-xhigh-fast",
      label: "claude-opus-4-7-thinking-xhigh-fast",
      description: "Opus 4.7 1M Thinking Fast",
    },
    {
      value: "claude-opus-4-7-thinking-max",
      label: "claude-opus-4-7-thinking-max",
      description: "Opus 4.7 1M Max Thinking",
    },
    {
      value: "claude-opus-4-7-thinking-max-fast",
      label: "claude-opus-4-7-thinking-max-fast",
      description: "Opus 4.7 1M Max Thinking Fast",
    },
    {
      value: "grok-build-0.1",
      label: "grok-build-0.1",
      description: "Grok Build 0.1 1M",
    },
    {
      value: "gpt-5.4-low",
      label: "gpt-5.4-low",
      description: "GPT-5.4 1M Low",
    },
    {
      value: "gpt-5.4-medium",
      label: "gpt-5.4-medium",
      description: "GPT-5.4 1M",
    },
    {
      value: "gpt-5.4-medium-fast",
      label: "gpt-5.4-medium-fast",
      description: "GPT-5.4 Fast",
    },
    {
      value: "gpt-5.4-xhigh",
      label: "gpt-5.4-xhigh",
      description: "GPT-5.4 1M Extra High",
    },
    {
      value: "gpt-5.4-xhigh-fast",
      label: "gpt-5.4-xhigh-fast",
      description: "GPT-5.4 Extra High Fast",
    },
    {
      value: "claude-4.6-opus-high",
      label: "claude-4.6-opus-high",
      description: "Opus 4.6 1M",
    },
    {
      value: "claude-4.6-opus-max",
      label: "claude-4.6-opus-max",
      description: "Opus 4.6 1M Max",
    },
    {
      value: "claude-4.6-opus-max-thinking",
      label: "claude-4.6-opus-max-thinking",
      description: "Opus 4.6 1M Max Thinking",
    },
    {
      value: "claude-4.6-opus-max-thinking-fast",
      label: "claude-4.6-opus-max-thinking-fast",
      description: "Opus 4.6 1M Max Thinking Fast",
    },
    {
      value: "claude-4.5-opus-high",
      label: "claude-4.5-opus-high",
      description: "Opus 4.5",
    },
    {
      value: "claude-4.5-opus-high-thinking",
      label: "claude-4.5-opus-high-thinking",
      description: "Opus 4.5 Thinking",
    },
    {
      value: "gpt-5.2-low",
      label: "gpt-5.2-low",
      description: "GPT-5.2 Low",
    },
    {
      value: "gpt-5.2-low-fast",
      label: "gpt-5.2-low-fast",
      description: "GPT-5.2 Low Fast",
    },
    {
      value: "gpt-5.2-fast",
      label: "gpt-5.2-fast",
      description: "GPT-5.2 Fast",
    },
    {
      value: "gpt-5.2-high",
      label: "gpt-5.2-high",
      description: "GPT-5.2 High",
    },
    {
      value: "gpt-5.2-high-fast",
      label: "gpt-5.2-high-fast",
      description: "GPT-5.2 High Fast",
    },
    {
      value: "gpt-5.2-xhigh",
      label: "gpt-5.2-xhigh",
      description: "GPT-5.2 Extra High",
    },
    {
      value: "gpt-5.2-xhigh-fast",
      label: "gpt-5.2-xhigh-fast",
      description: "GPT-5.2 Extra High Fast",
    },
    {
      value: "gpt-5.4-mini-none",
      label: "gpt-5.4-mini-none",
      description: "GPT-5.4 Mini None",
    },
    {
      value: "gpt-5.4-mini-low",
      label: "gpt-5.4-mini-low",
      description: "GPT-5.4 Mini Low",
    },
    {
      value: "gpt-5.4-mini-medium",
      label: "gpt-5.4-mini-medium",
      description: "GPT-5.4 Mini",
    },
    {
      value: "gpt-5.4-mini-high",
      label: "gpt-5.4-mini-high",
      description: "GPT-5.4 Mini High",
    },
    {
      value: "gpt-5.4-mini-xhigh",
      label: "gpt-5.4-mini-xhigh",
      description: "GPT-5.4 Mini Extra High",
    },
    {
      value: "gpt-5.4-nano-none",
      label: "gpt-5.4-nano-none",
      description: "GPT-5.4 Nano None",
    },
    {
      value: "gpt-5.4-nano-low",
      label: "gpt-5.4-nano-low",
      description: "GPT-5.4 Nano Low",
    },
    {
      value: "gpt-5.4-nano-medium",
      label: "gpt-5.4-nano-medium",
      description: "GPT-5.4 Nano",
    },
    {
      value: "gpt-5.4-nano-high",
      label: "gpt-5.4-nano-high",
      description: "GPT-5.4 Nano High",
    },
    {
      value: "gpt-5.4-nano-xhigh",
      label: "gpt-5.4-nano-xhigh",
      description: "GPT-5.4 Nano Extra High",
    },
    {
      value: "grok-4.3",
      label: "grok-4.3",
      description: "Grok 4.3 1M",
    },
    {
      value: "claude-4.5-sonnet",
      label: "claude-4.5-sonnet",
      description: "Sonnet 4.5",
    },
    {
      value: "claude-4.5-sonnet-thinking",
      label: "claude-4.5-sonnet-thinking",
      description: "Sonnet 4.5 Thinking",
    },
    {
      value: "gpt-5.1-low",
      label: "gpt-5.1-low",
      description: "GPT-5.1 Low",
    },
    {
      value: "gpt-5.1",
      label: "gpt-5.1",
      description: "GPT-5.1",
    },
    {
      value: "gpt-5.1-high",
      label: "gpt-5.1-high",
      description: "GPT-5.1 High",
    },
    {
      value: "gpt-5.1-codex-mini-low",
      label: "gpt-5.1-codex-mini-low",
      description: "Codex 5.1 Mini Low",
    },
    {
      value: "gpt-5.1-codex-mini",
      label: "gpt-5.1-codex-mini",
      description: "Codex 5.1 Mini",
    },
    {
      value: "gpt-5.1-codex-mini-high",
      label: "gpt-5.1-codex-mini-high",
      description: "Codex 5.1 Mini High",
    },
    {
      value: "claude-4-sonnet",
      label: "claude-4-sonnet",
      description: "Sonnet 4",
    },
    {
      value: "claude-4-sonnet-thinking",
      label: "claude-4-sonnet-thinking",
      description: "Sonnet 4 Thinking",
    },
    {
      value: "gpt-5-mini",
      label: "gpt-5-mini",
      description: "GPT-5 Mini",
    },
    {
      value: "kimi-k2.5",
      label: "kimi-k2.5",
      description: "Kimi K2.5",
    },
  ],
  DEFAULT: "composer-2.5-fast",
};

type CursorModelRow = {
  name: string;
  description: string;
  current: boolean;
  default: boolean;
};

const CURSOR_MODELS_TIMEOUT_MS = 10_000;
const CURSOR_CHATS_ROOT = path.join(os.homedir(), '.cursor', 'chats');
// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;
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

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('cursor', input);
  }
}

