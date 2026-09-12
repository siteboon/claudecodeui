import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { codexAppServer, type CodexServerModel } from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  AppError,
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/** How long a successful `model/list` answer stays fresh. */
const LIVE_CATALOG_TTL_MS = 60_000;

/** Test seam: replaces the app-server round-trip with a fixture-backed reader. */
export type CodexProviderModelsDependencies = {
  listModels?: () => Promise<CodexServerModel[]>;
};

/**
 * Maps one app-server catalog entry onto the picker's option shape.
 *
 * `supportedReasoningEfforts` is the CLI's own answer for which effort levels
 * the model accepts, so the effort picker can no longer drift from what the
 * pinned CLI actually supports. The curated list had curated defaults on top;
 * the CLI's `defaultReasoningEffort` takes that role here, and a default the
 * server reports outside its own supported list is dropped rather than shown.
 */
const toCodexModelOption = (model: CodexServerModel): ProviderModelOption => {
  const effortValues = (model.supportedReasoningEfforts ?? [])
    .map((entry) => readOptionalString(entry?.reasoningEffort))
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  const defaultEffort = readOptionalString(model.defaultReasoningEffort);
  return {
    value: model.id,
    label: readOptionalString(model.displayName) ?? model.id,
    ...(readOptionalString(model.description) ? { description: readOptionalString(model.description) as string } : {}),
    ...(effortValues.length > 0
      ? {
        effort: {
          values: effortValues.map((value) => ({ value })),
          ...(defaultEffort && effortValues.includes(defaultEffort) ? { default: defaultEffort } : {}),
        },
      }
      : {}),
  };
};

/**
 * Builds the picker catalog from the CLI answer.
 *
 * There is deliberately no curated fallback list behind this: a hardcoded
 * catalog goes stale against every CLI upgrade and login change, and offering
 * models the install cannot run is worse than the picker surfacing the CLI
 * failure. An empty answer is treated as the same failure.
 */
const buildCatalogFromServer = (models: CodexServerModel[]): ProviderModelsDefinition => {
  // Hidden is already dropped in the client; filtering again here keeps a
  // stubbed listModels from smuggling a retired model into the picker.
  const options = models
    .filter((model) => model.hidden !== true)
    .map(toCodexModelOption);
  if (options.length === 0) {
    throw new AppError('Codex reported no usable models.', {
      code: 'CODEX_MODELS_UNAVAILABLE',
      statusCode: 502,
    });
  }

  const defaultOption = options[models.findIndex((model) => model.isDefault === true)] ?? options[0];
  return {
    OPTIONS: options,
    DEFAULT: defaultOption.value,
  };
};

const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

/** Provider registry model adapter for the live Codex catalog and active config. */
export class CodexProviderModels implements IProviderModels {
  private readonly listModels: () => Promise<CodexServerModel[]>;
  private liveCatalog: Promise<ProviderModelsDefinition> | null = null;
  private liveCatalogExpiresAt = 0;

  constructor(dependencies: CodexProviderModelsDependencies = {}) {
    this.listModels = dependencies.listModels ?? (() => codexAppServer.listModels());
  }

  /**
   * Reports the picker catalog from `codex app-server`'s `model/list`.
   *
   * The round-trip spawns a short-lived app-server child, so a successful
   * answer is cached briefly and concurrent callers share one in-flight run
   * (the picker, the active-model lookup, and effort validation all resolve
   * the catalog within the same page load). A failed run is not cached; the
   * next caller retries rather than waiting out the TTL on an error.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (!this.liveCatalog || Date.now() >= this.liveCatalogExpiresAt) {
      const run = (async () => buildCatalogFromServer(await this.listModels()))();
      this.liveCatalog = run;
      this.liveCatalogExpiresAt = Date.now() + LIVE_CATALOG_TTL_MS;
      void run.catch(() => {
        if (this.liveCatalog === run) {
          this.liveCatalog = null;
          this.liveCatalogExpiresAt = 0;
        }
      });
    }

    return this.liveCatalog;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    // The fallback here is the CLI catalog's own default, not a curated one,
    // so an unreadable config still yields a model this install can run.
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (model) {
        return { model };
      }
    } catch {
      // Fall through to the CLI catalog's default when the config is missing
      // or unreadable.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
