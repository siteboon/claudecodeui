import fsSync from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';
import { getZCodeDatabasePath, getZCodeStorageDir } from './zcode-data-root.js';

/**
 * ZCode builtin models definition as fallback when config read fails.
 * Based on integration plan §3.2.5 and spike findings (GLM-5.3 with 1M context, 128K output).
 */
const ZCODE_BUILTIN_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'GLM-5.3',
      label: 'GLM-5.3',
      description: 'ZCode default model with 1M context window and 128K output tokens',
      effort: {
        default: 'max',
        values: [
          { value: 'low', description: 'Faster, less detailed reasoning' },
          { value: 'high', description: 'Balanced reasoning for most tasks' },
          { value: 'max', description: 'Maximum reasoning for complex tasks' },
        ],
      },
    },
  ],
  DEFAULT: 'GLM-5.3',
};

const EFFORT_DESCRIPTIONS: Record<string, string> = {
  low: 'Faster, less detailed reasoning',
  high: 'Balanced reasoning for most tasks',
  max: 'Maximum reasoning for complex tasks',
};

/**
 * Reads and parses ZCode's v2 config.json to extract model definitions.
 * Based on integration plan §3.2.5: `provider.*.models` entries with
 * `reasoning.variants` and `limit.context`/`limit.output`.
 */
const readZCodeModelConfig = async (): Promise<ProviderModelsDefinition> => {
  try {
    const configPath = path.join(getZCodeStorageDir(), 'v2', 'config.json');
    const content = await readFile(configPath, 'utf8');
    const config = readObjectRecord(JSON.parse(content));

    if (!config) {
      return ZCODE_BUILTIN_MODELS;
    }

    const providers = readObjectRecord(config.provider);
    if (!providers) {
      return ZCODE_BUILTIN_MODELS;
    }

    const modelOptions: ProviderModelOption[] = [];
    const seenModelKeys = new Set<string>();

    for (const providerConfig of Object.values(providers)) {
      const providerRecord = readObjectRecord(providerConfig);
      // Skip explicitly disabled providers
      if (providerRecord?.enabled === false) continue;

      const models = readObjectRecord(providerRecord?.models);
      if (!models) continue;

      for (const [modelKey, modelConfig] of Object.entries(models)) {
        if (seenModelKeys.has(modelKey)) continue;

        const modelRecord = readObjectRecord(modelConfig);
        if (!modelRecord) continue;

        seenModelKeys.add(modelKey);

        const reasoning = readObjectRecord(modelRecord.reasoning);
        const variants = reasoning?.variants;
        const hasReasoning = Array.isArray(variants) && variants.length > 0;

        const limits = readObjectRecord(modelRecord.limit);
        const contextLimit = limits?.context;
        const outputLimit = limits?.output;

        const limitDescriptions: string[] = [];
        if (typeof contextLimit === 'number') {
          limitDescriptions.push(`${(contextLimit / 1000).toFixed(0)}K context`);
        }
        if (typeof outputLimit === 'number') {
          limitDescriptions.push(`${(outputLimit / 1000).toFixed(0)}K output`);
        }

        const description = limitDescriptions.length > 0
          ? `ZCode model with ${limitDescriptions.join(', ')}`
          : `ZCode ${modelKey} model`;

        let effort: ProviderModelOption['effort'] | undefined;
        if (hasReasoning && Array.isArray(variants)) {
          const sortedVariants = [...variants].sort();
          effort = {
            default: 'max',
            values: sortedVariants.map((variant: string) => {
              const normalized = variant.toLowerCase();
              return {
                value: normalized,
                description: EFFORT_DESCRIPTIONS[normalized] || `${normalized} reasoning level`,
              };
            }),
          };
        }

        modelOptions.push({
          value: modelKey,
          label: modelKey,
          description: readOptionalString(modelRecord.description) || description,
          effort: hasReasoning ? effort : undefined,
        });
      }
    }

    if (modelOptions.length === 0) {
      return ZCODE_BUILTIN_MODELS;
    }

    return {
      OPTIONS: modelOptions,
      DEFAULT: modelOptions[0]?.value ?? 'GLM-5.3',
    };
  } catch {
    // Config read failed, return builtin models
    return ZCODE_BUILTIN_MODELS;
  }
};

/**
 * Reads the model a ZCode session last ran with from ZCode's own SQLite
 * store (most recent `message.data.modelID` per integration plan §3.2.5).
 *
 * Consumers: `ZCodeProviderModels.getCurrentActiveModel` (app session id
 * mapped to the provider id first) and the zcode runtime provider (which
 * already holds the provider session id and skips redundant `session/setModel`
 * calls when the requested model matches). Returns null when unknown.
 */
export function readZCodeSessionModelInfoFromDb(providerSessionId: string): { modelId: string; variant?: string } | null {
  const dbPath = getZCodeDatabasePath();

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const recentMessage = db
      .prepare(
        `SELECT data FROM message
         WHERE session_id = ?
         ORDER BY time_created DESC
         LIMIT 1`
      )
      .get(providerSessionId) as { data: string } | undefined;

    if (!recentMessage) {
      return null;
    }

    const messageData = readObjectRecord(JSON.parse(recentMessage.data));
    const modelRecord = readObjectRecord(messageData?.model);
    const modelId = readOptionalString(messageData?.modelID)
      || readOptionalString(modelRecord?.modelID)
      || readOptionalString(modelRecord?.modelId);

    if (!modelId) {
      return null;
    }

    const variant = readOptionalString(messageData?.variant)
      || readOptionalString(modelRecord?.variant);

    return {
      modelId,
      variant: variant || undefined,
    };
  } catch {
    // Database missing or unreadable - model unknown
    return null;
  } finally {
    if (db) {
      db.close();
    }
  }
}

/**
 * Reads the model a ZCode session last ran with from ZCode's own SQLite
 * store (most recent `message.data.modelID` per integration plan §3.2.5).
 *
 * Consumers: `ZCodeProviderModels.getCurrentActiveModel` (app session id
 * mapped to the provider id first) and the zcode runtime provider (which
 * already holds the provider session id and skips redundant `session/setModel`
 * calls when the requested model matches). Returns null when unknown.
 */
export function readZCodeSessionModelFromDb(providerSessionId: string): string | null {
  return readZCodeSessionModelInfoFromDb(providerSessionId)?.modelId ?? null;
}

/**
 * Resolves a model name/key string into ZCode's protocol model object `{ providerId, modelId, variant? }`.
 *
 * Handles:
 * - Full model refs formatted as `providerId/modelId` (e.g. `builtin:bigmodel-coding-plan/GLM-5.3`)
 * - Bare model keys (e.g. `GLM-5.3`), by looking up the active/enabled provider from config or defaulting
 * - Optional reasoning effort variant (e.g. `low`, `medium`, `high`, `max`)
 *
 * Consumer: `server/modules/providers/list/zcode/zcode-runtime.provider.ts`
 */
export function resolveZCodeModelRef(
  modelKey: string,
  variant?: string,
): { providerId: string; modelId: string; variant?: string } {
  const trimmed = modelKey.trim();
  const trimmedVariant = variant && variant !== 'default' ? variant.trim() : undefined;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex >= 0) {
    return {
      providerId: trimmed.slice(0, slashIndex).trim(),
      modelId: trimmed.slice(slashIndex + 1).trim(),
      ...(trimmedVariant ? { variant: trimmedVariant } : {}),
    };
  }

  // Look up enabled provider in config if possible
  try {
    const configPath = path.join(getZCodeStorageDir(), 'v2', 'config.json');
    const content = fsSync.readFileSync(configPath, 'utf8');
    const config = readObjectRecord(JSON.parse(content));
    const providers = readObjectRecord(config?.provider);
    if (providers) {
      for (const [providerId, providerConfig] of Object.entries(providers)) {
        const providerRecord = readObjectRecord(providerConfig);
        if (providerRecord?.enabled === false) continue;
        const models = readObjectRecord(providerRecord?.models);
        if (models && trimmed in models) {
          return {
            providerId,
            modelId: trimmed,
            ...(trimmedVariant ? { variant: trimmedVariant } : {}),
          };
        }
      }
      // Fallback: search even disabled providers if matching model
      for (const [providerId, providerConfig] of Object.entries(providers)) {
        const providerRecord = readObjectRecord(providerConfig);
        const models = readObjectRecord(providerRecord?.models);
        if (models && trimmed in models) {
          return {
            providerId,
            modelId: trimmed,
            ...(trimmedVariant ? { variant: trimmedVariant } : {}),
          };
        }
      }
    }
  } catch {
    // Config read failed, use default
  }

  return {
    providerId: 'builtin:bigmodel-coding-plan',
    modelId: trimmed,
    ...(trimmedVariant ? { variant: trimmedVariant } : {}),
  };
}

/**
 * ZCode models provider implementing model catalog and active model detection.
 */
export class ZCodeProviderModels implements IProviderModels {
  private cachedModels: ProviderModelsDefinition | null = null;

  /**
   * Returns supported models from ZCode config or builtin fallback.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (!this.cachedModels) {
      this.cachedModels = await readZCodeModelConfig();
    }
    return this.cachedModels;
  }

  /**
   * Returns the current active model for a session or default.
   *
   * The sessionId is the app-facing session id; it is mapped through the
   * sessions index to the ZCode-native session id before reading ZCode's
   * own database.
   */
  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (sessionId?.trim()) {
      const session = sessionsDb.getSessionById(sessionId);
      const providerSessionId = session ? readOptionalString(session.provider_session_id) : null;
      const modelInfo = providerSessionId
        ? readZCodeSessionModelInfoFromDb(providerSessionId)
        : null;

      if (modelInfo?.modelId) {
        if (session && !session.effort && modelInfo.variant) {
          sessionsDb.setSessionEffort(sessionId, modelInfo.variant);
        }
        return { model: modelInfo.modelId };
      }
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  /**
   * Clears the cached models.
   *
   * Consumer: `server/modules/providers/tests/zcode-models.test.ts`
   * (isolation between fixture config cases).
   */
  clearCache(): void {
    this.cachedModels = null;
  }
}
