import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { IProvider } from '@/shared/interfaces.js';
import type {
  LLMProvider,
  ProviderCurrentActiveModel,
  ProviderModelsCacheInfo,
  ProviderModelsDefinition,
  ProviderModelsResult,
} from '@/shared/types.js';

export const PROVIDER_MODELS_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PROVIDER_MODELS_CACHE_VERSION = 1;

type ProviderModelsServiceDependencies = {
  resolveProvider?: (provider: LLMProvider) => Pick<IProvider, 'models'>;
  cachePath?: string;
  now?: () => number;
};

type ProviderModelsOptions = {
  bypassCache?: boolean;
};

type ProviderModelsCacheEntry = {
  updatedAt: number;
  expiresAt: number;
  models: ProviderModelsDefinition;
};

type ProviderModelsCacheFile = {
  version: number;
  entries: Record<string, ProviderModelsCacheEntry>;
};

const getProviderModelsCachePath = (): string => path.join(
  os.homedir(),
  '.cloudcli',
  'provider-models-cache.json',
);

const toProviderModelsCacheInfo = (
  entry: ProviderModelsCacheEntry,
  source: ProviderModelsCacheInfo['source'],
): ProviderModelsCacheInfo => ({
  updatedAt: new Date(entry.updatedAt).toISOString(),
  expiresAt: new Date(entry.expiresAt).toISOString(),
  source,
});

const isProviderModelOption = (
  value: unknown,
): value is ProviderModelsDefinition['OPTIONS'][number] => (
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as ProviderModelsDefinition['OPTIONS'][number]).value === 'string'
  && typeof (value as ProviderModelsDefinition['OPTIONS'][number]).label === 'string'
  && (
    typeof (value as ProviderModelsDefinition['OPTIONS'][number]).description === 'undefined'
    || typeof (value as ProviderModelsDefinition['OPTIONS'][number]).description === 'string'
  )
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
  && typeof (value as ProviderModelsCacheEntry).updatedAt === 'number'
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

    return {
      version: PROVIDER_MODELS_CACHE_VERSION,
      entries,
    };
  } catch {
    return null;
  }
};

const writeProviderModelsCacheFile = async (
  cachePath: string,
  entries: Map<LLMProvider, ProviderModelsCacheEntry>,
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

/**
 * Provider model lookup service.
 *
 * Routes and other service callers use this layer instead of resolving provider
 * classes directly so the provider-registry dependency stays centralized in one
 * place.
 */
export const createProviderModelsService = (dependencies: ProviderModelsServiceDependencies = {}) => {
  const resolveProvider = dependencies.resolveProvider ?? providerRegistry.resolveProvider;
  const cachePath = dependencies.cachePath ?? getProviderModelsCachePath();
  const now = dependencies.now ?? (() => Date.now());
  const memoryCache = new Map<LLMProvider, ProviderModelsCacheEntry>();
  const pendingRequests = new Map<LLMProvider, Promise<ProviderModelsResult>>();
  let persistedCacheLoaded = false;
  let persistedCacheLoadPromise: Promise<void> | null = null;

  const pruneExpiredMemoryEntry = (
    provider: LLMProvider,
    currentTime: number,
    source: ProviderModelsCacheInfo['source'],
  ): ProviderModelsResult | null => {
    const cachedEntry = memoryCache.get(provider);
    if (!cachedEntry) {
      return null;
    }

    if (cachedEntry.expiresAt > currentTime) {
      return {
        models: cachedEntry.models,
        cache: toProviderModelsCacheInfo(cachedEntry, source),
      };
    }

    memoryCache.delete(provider);
    return null;
  };

  const loadPersistedCache = async (): Promise<void> => {
    if (persistedCacheLoaded) {
      return;
    }

    if (!persistedCacheLoadPromise) {
      persistedCacheLoadPromise = (async () => {
        const cacheFile = await readProviderModelsCacheFile(cachePath);
        const currentTime = now();

        for (const [provider, entry] of Object.entries(cacheFile?.entries ?? {})) {
          if (entry.expiresAt > currentTime) {
            memoryCache.set(provider as LLMProvider, entry);
          }
        }

        persistedCacheLoaded = true;
      })().finally(() => {
        persistedCacheLoadPromise = null;
      });
    }

    await persistedCacheLoadPromise;
  };

  const persistCache = async (): Promise<void> => {
    try {
      await writeProviderModelsCacheFile(cachePath, memoryCache, now());
    } catch (error) {
      console.warn('Unable to persist provider models cache:', error);
    }
  };

  const setCacheEntry = async (
    provider: LLMProvider,
    models: ProviderModelsDefinition,
  ): Promise<ProviderModelsCacheEntry> => {
    const currentTime = now();
    const entry: ProviderModelsCacheEntry = {
      updatedAt: currentTime,
      expiresAt: currentTime + PROVIDER_MODELS_CACHE_TTL_MS,
      models,
    };

    memoryCache.set(provider, entry);
    await persistCache();
    return entry;
  };

  const loadAndCacheModels = (
    provider: LLMProvider,
  ): Promise<ProviderModelsResult> => {
    const request = resolveProvider(provider).models.getSupportedModels()
      .then(async (models) => {
        const entry = await setCacheEntry(provider, models);
        return {
          models,
          cache: toProviderModelsCacheInfo(entry, 'fresh'),
        };
      })
      .finally(() => {
        pendingRequests.delete(provider);
      });

    pendingRequests.set(provider, request);
    return request;
  };

  const getProviderModels = async (
    provider: LLMProvider,
    options: ProviderModelsOptions = {},
  ): Promise<ProviderModelsResult> => {
    if (options.bypassCache) {
      const pendingRequest = pendingRequests.get(provider);
      if (pendingRequest) {
        return pendingRequest;
      }

      return loadAndCacheModels(provider);
    }

    const cachedModels = pruneExpiredMemoryEntry(provider, now(), 'memory');
    if (cachedModels) {
      return cachedModels;
    }

    const pendingRequest = pendingRequests.get(provider);
    if (pendingRequest) {
      return pendingRequest;
    }

    await loadPersistedCache();

    const persistedModels = pruneExpiredMemoryEntry(provider, now(), 'disk');
    if (persistedModels) {
      return persistedModels;
    }

    const postLoadPendingRequest = pendingRequests.get(provider);
    if (postLoadPendingRequest) {
      return postLoadPendingRequest;
    }

    return loadAndCacheModels(provider);
  };

  const getCurrentActiveModel = async (
    provider: LLMProvider,
    sessionId?: string,
  ): Promise<ProviderCurrentActiveModel> => resolveProvider(provider).models.getCurrentActiveModel(sessionId);

  const clearCache = (): void => {
    memoryCache.clear();
    pendingRequests.clear();
    persistedCacheLoaded = false;
    persistedCacheLoadPromise = null;
  };

  return {
    getProviderModels,
    getCurrentActiveModel,
    clearCache,
  };
};

export const providerModelsService = createProviderModelsService();
