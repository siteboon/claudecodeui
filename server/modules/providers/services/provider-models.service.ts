import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import type { LLMProvider, ProviderModelOption, ProviderModelsDefinition } from '@/shared/types.js';

const OPEN_CODE_MODELS_TIMEOUT_MS = 20_000;
export const PROVIDER_MODELS_CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const PROVIDER_MODELS_CACHE_VERSION = 1;

/**
 * Claude (Anthropic) — SDK-style ids used by the UI and claude-sdk.js.
 */
export const CLAUDE_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'opus', label: 'Opus' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6' },
    { value: 'opusplan', label: 'Opus Plan' },
    { value: 'sonnet[1m]', label: 'Sonnet [1M]' },
    { value: 'opus[1m]', label: 'Opus [1M]' },
  ],
  DEFAULT: 'opus',
};

export const CURSOR_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'opus-4.6-thinking', label: 'Claude 4.6 Opus (Thinking)' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3' },
    { value: 'gpt-5.2-high', label: 'GPT-5.2 High' },
    { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    { value: 'opus-4.5-thinking', label: 'Claude 4.5 Opus (Thinking)' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1', label: 'GPT-5.1' },
    { value: 'gpt-5.1-high', label: 'GPT-5.1 High' },
    { value: 'composer-1', label: 'Composer 1' },
    { value: 'auto', label: 'Auto' },
    { value: 'sonnet-4.5', label: 'Claude 4.5 Sonnet' },
    { value: 'sonnet-4.5-thinking', label: 'Claude 4.5 Sonnet (Thinking)' },
    { value: 'opus-4.5', label: 'Claude 4.5 Opus' },
    { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    { value: 'gpt-5.1-codex-high', label: 'GPT-5.1 Codex High' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { value: 'gpt-5.1-codex-max-high', label: 'GPT-5.1 Codex Max High' },
    { value: 'opus-4.1', label: 'Claude 4.1 Opus' },
    { value: 'grok', label: 'Grok' },
  ],
  DEFAULT: 'gpt-5.3-codex',
};

export const CODEX_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'gpt-5.5', label: 'GPT-5.5' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { value: 'o3', label: 'O3' },
    { value: 'o4-mini', label: 'O4-mini' },
  ],
  DEFAULT: 'gpt-5.4',
};

export const GEMINI_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro Experimental' },
    { value: 'gemini-2.0-flash-thinking-exp', label: 'Gemini 2.0 Flash Thinking' },
  ],
  DEFAULT: 'gemini-3.1-pro-preview',
};

/** Static OpenCode defaults when `opencode models` is unavailable or returns nothing. */
export const OPENCODE_MODELS: ProviderModelsDefinition = {
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

const BUILTIN_BY_PROVIDER: Record<Exclude<LLMProvider, 'opencode'>, ProviderModelsDefinition> = {
  claude: CLAUDE_MODELS,
  cursor: CURSOR_MODELS,
  codex: CODEX_MODELS,
  gemini: GEMINI_MODELS,
};

type ProviderModelsOptions = {
  cwd?: string;
};

type ProviderModelsLoader = (
  provider: LLMProvider,
  options?: ProviderModelsOptions,
) => Promise<ProviderModelsDefinition>;

type ProviderModelsCacheEntry = {
  expiresAt: number;
  models: ProviderModelsDefinition;
};

type ProviderModelsCacheFile = {
  version: number;
  entries: Record<string, ProviderModelsCacheEntry>;
};

type ProviderModelsServiceDependencies = {
  cachePath?: string;
  loadModels?: ProviderModelsLoader;
  now?: () => number;
};

const MODEL_ID_LINE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;

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
  const fromStatic = OPENCODE_MODELS.OPTIONS.find((o) => o.value === id)?.label;
  if (fromStatic) {
    return fromStatic;
  }
  const tail = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
  return tail.replace(/-/g, ' ');
};

const buildOpenCodeDefinitionFromIds = (ids: string[]): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = ids.map((value) => ({
    value,
    label: labelForOpenCodeModelId(value),
  }));
  const defaultValue = options.some((o) => o.value === OPENCODE_MODELS.DEFAULT)
    ? OPENCODE_MODELS.DEFAULT
    : (options[0]?.value ?? OPENCODE_MODELS.DEFAULT);
  return { OPTIONS: options, DEFAULT: defaultValue };
};

const resolveOpenCodeCwd = (cwd?: string): string => {
  if (cwd && fsSync.existsSync(cwd)) {
    return cwd;
  }
  return process.cwd();
};

const getProviderModelsCachePath = (): string =>
  process.env.CLOUDCLI_PROVIDER_MODELS_CACHE_PATH
  || path.join(os.homedir(), '.cloudcli', 'provider-models-cache.json');

const getProviderModelsCacheKey = (
  provider: LLMProvider,
  options?: ProviderModelsOptions,
): string => {
  if (provider === 'opencode') {
    return `${provider}:${resolveOpenCodeCwd(options?.cwd)}`;
  }

  return provider;
};

const isProviderModelOption = (value: unknown): value is ProviderModelOption => (
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as ProviderModelOption).value === 'string'
  && typeof (value as ProviderModelOption).label === 'string'
);

const isProviderModelsDefinition = (value: unknown): value is ProviderModelsDefinition => (
  Boolean(value)
  && typeof value === 'object'
  && Array.isArray((value as ProviderModelsDefinition).OPTIONS)
  && (value as ProviderModelsDefinition).OPTIONS.every(isProviderModelOption)
  && typeof (value as ProviderModelsDefinition).DEFAULT === 'string'
);

const isProviderModelsCacheEntry = (value: unknown): value is ProviderModelsCacheEntry => (
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as ProviderModelsCacheEntry).expiresAt === 'number'
  && isProviderModelsDefinition((value as ProviderModelsCacheEntry).models)
);

const readProviderModelsCacheFile = async (
  cachePath: string,
): Promise<ProviderModelsCacheFile | null> => {
  try {
    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProviderModelsCacheFile>;
    if (parsed.version !== PROVIDER_MODELS_CACHE_VERSION || !parsed.entries || typeof parsed.entries !== 'object') {
      return null;
    }

    const entries = Object.fromEntries(
      Object.entries(parsed.entries).filter((entry): entry is [string, ProviderModelsCacheEntry] =>
        isProviderModelsCacheEntry(entry[1]),
      ),
    );
    return { version: PROVIDER_MODELS_CACHE_VERSION, entries };
  } catch {
    return null;
  }
};

const writeProviderModelsCacheFile = async (
  cachePath: string,
  entries: Map<string, ProviderModelsCacheEntry>,
  now: number,
): Promise<void> => {
  const serializableEntries = Object.fromEntries(
    [...entries.entries()].filter(([, entry]) => entry.expiresAt > now),
  );
  const payload: ProviderModelsCacheFile = {
    version: PROVIDER_MODELS_CACHE_VERSION,
    entries: serializableEntries,
  };

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const runOpenCodeModelsCommand = (cwd?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const spawnFn = process.platform === 'win32' ? crossSpawn : spawn;
    const child = spawnFn('opencode', ['models'], {
      cwd: resolveOpenCodeCwd(cwd),
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      if (!settled) {
        settled = true;
        reject(new Error('opencode models timed out'));
      }
    }, OPEN_CODE_MODELS_TIMEOUT_MS);

    const finish = (err: Error | null, out: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(out);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      finish(error instanceof Error ? error : new Error(String(error)), '');
    });
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(stderr.trim() || `opencode models exited with code ${code}`), '');
        return;
      }
      finish(null, stdout);
    });
  });

const getBuiltinProviderDefinition = (provider: LLMProvider): ProviderModelsDefinition => {
  if (provider === 'opencode') {
    return OPENCODE_MODELS;
  }
  return BUILTIN_BY_PROVIDER[provider];
};

async function getProviderModelsInternal(
  provider: LLMProvider,
  options?: { cwd?: string },
): Promise<ProviderModelsDefinition> {
  if (provider !== 'opencode') {
    return getBuiltinProviderDefinition(provider);
  }

  try {
    const stdout = await runOpenCodeModelsCommand(options?.cwd);
    const ids = parseOpenCodeModelsStdout(stdout);
    if (ids.length === 0) {
      return OPENCODE_MODELS;
    }
    return buildOpenCodeDefinitionFromIds(ids);
  } catch {
    return OPENCODE_MODELS;
  }
}

export const createProviderModelsService = (dependencies: ProviderModelsServiceDependencies = {}) => {
  const memoryCache = new Map<string, ProviderModelsCacheEntry>();
  const pendingRequests = new Map<string, Promise<ProviderModelsDefinition>>();
  const loadModels = dependencies.loadModels ?? getProviderModelsInternal;
  const now = dependencies.now ?? (() => Date.now());
  let persistedCacheLoaded = false;
  let persistedCacheLoadPromise: Promise<void> | null = null;

  const loadPersistedCache = async (cachePath: string): Promise<void> => {
    if (persistedCacheLoaded) {
      return;
    }

    if (!persistedCacheLoadPromise) {
      persistedCacheLoadPromise = (async () => {
        const cacheFile = await readProviderModelsCacheFile(cachePath);
        const currentTime = now();
        for (const [key, entry] of Object.entries(cacheFile?.entries ?? {})) {
          if (entry.expiresAt > currentTime) {
            memoryCache.set(key, entry);
          }
        }
        persistedCacheLoaded = true;
      })().finally(() => {
        persistedCacheLoadPromise = null;
      });
    }

    await persistedCacheLoadPromise;
  };

  const persistCache = async (cachePath: string): Promise<void> => {
    try {
      await writeProviderModelsCacheFile(cachePath, memoryCache, now());
    } catch (error) {
      console.warn('Unable to persist provider models cache:', error);
    }
  };

  const setCacheEntry = async (
    cachePath: string,
    cacheKey: string,
    models: ProviderModelsDefinition,
  ): Promise<void> => {
    const entry = {
      expiresAt: now() + PROVIDER_MODELS_CACHE_TTL_MS,
      models,
    };
    memoryCache.set(cacheKey, entry);

    await persistCache(cachePath);
  };

  const loadAndCacheModels = (
    provider: LLMProvider,
    options: ProviderModelsOptions | undefined,
    cachePath: string,
    cacheKey: string,
  ): Promise<ProviderModelsDefinition> => {
    const request = loadModels(provider, options)
      .then(async (models) => {
        await setCacheEntry(cachePath, cacheKey, models);
        return models;
      })
      .finally(() => {
        pendingRequests.delete(cacheKey);
      });

    pendingRequests.set(cacheKey, request);
    return request;
  };

  const pruneExpiredMemoryEntry = (cacheKey: string, currentTime: number): ProviderModelsDefinition | null => {
    const cachedEntry = memoryCache.get(cacheKey);
    if (!cachedEntry) {
      return null;
    }

    if (cachedEntry.expiresAt > currentTime) {
      return cachedEntry.models;
    }

    memoryCache.delete(cacheKey);
    return null;
  };

  const getProviderModels = async (
    provider: LLMProvider,
    options?: ProviderModelsOptions,
  ): Promise<ProviderModelsDefinition> => {
    const cachePath = dependencies.cachePath ?? getProviderModelsCachePath();
    const cacheKey = getProviderModelsCacheKey(provider, options);
    const cachedModels = pruneExpiredMemoryEntry(cacheKey, now());
    if (cachedModels) {
      return cachedModels;
    }

    const pendingRequest = pendingRequests.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    await loadPersistedCache(cachePath);
    const persistedModels = pruneExpiredMemoryEntry(cacheKey, now());
    if (persistedModels) {
      return persistedModels;
    }

    const postLoadPendingRequest = pendingRequests.get(cacheKey);
    if (postLoadPendingRequest) {
      return postLoadPendingRequest;
    }

    return loadAndCacheModels(provider, options, cachePath, cacheKey);
  };

  const clearCache = (): void => {
    memoryCache.clear();
    pendingRequests.clear();
    persistedCacheLoaded = false;
    persistedCacheLoadPromise = null;
  };

  return {
    getProviderModels,
    clearCache,
  };
};

export const providerModelsService = createProviderModelsService();
