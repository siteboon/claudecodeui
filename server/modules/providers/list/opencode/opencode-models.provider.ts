// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution, matching
// the choice made in the OpenCode runtime adapter.
import crossSpawn from 'cross-spawn';
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
  getOpenCodeDatabasePath,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/** How long a successful `opencode models --verbose` answer stays fresh. */
const LIVE_CATALOG_TTL_MS = 60_000;

/** Kill bound for one discovery invocation; the CLI answers in ~2s normally. */
const OPENCODE_MODELS_CLI_TIMEOUT_MS = 15_000;

/** Preferred picker default when the live catalog contains it. */
const OPENCODE_PREFERRED_DEFAULT = 'opencode/gpt-5.6-terra';

/** One `opencode models --verbose` record, narrowed to the picker's fields. */
type OpenCodeCliModel = {
  id: string;
  providerId: string;
  name: string | null;
  variants: string[] | null;
};

/**
 * Maps CLI variant names onto the picker's effort block.
 *
 * The CLI exposes variants by name only; the runtime forwards the chosen value
 * as `--variant`, so the names pass through untouched.
 */
const toOpenCodeEffort = (
  variantKeys: string[],
): ProviderModelOption['effort'] => ({
  values: variantKeys.map((value) => ({ value })),
});

const countJsonBraces = (text: string): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    }
  }
  return depth;
};

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parseOpenCodeCliModels = (stdout: string): OpenCodeCliModel[] => {
  // `--verbose` prints `providerID/modelID` lines interleaved with one pretty-
  // printed JSON object per model. The objects are the payload; the bare lines
  // only fill in the provider id when an object is missing one.
  const lines = stdout.split(/\r?\n/);
  const models: OpenCodeCliModel[] = [];
  const seen = new Set<string>();
  let pendingLine: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    index += 1;
    if (!line) {
      continue;
    }

    if (!line.startsWith('{')) {
      if (line.includes('/')) {
        pendingLine = line;
      }
      continue;
    }

    // Pretty-printed objects span many lines; buffer until the braces balance.
    let json = line;
    while (index < lines.length && countJsonBraces(json) > 0) {
      json += `\n${lines[index]}`;
      index += 1;
    }

    const record = readObjectRecord(safeJsonParse(json));
    if (!record) {
      continue;
    }

    const modelId = readOptionalString(record.id);
    const providerId = readOptionalString(record.providerID)
      ?? readOptionalString(record.providerId)
      ?? pendingLine?.split('/')[0]
      ?? null;
    if (!modelId || !providerId) {
      continue;
    }

    // Retired catalog entries still print; offering them would hand the picker
    // a model the CLI refuses to run.
    const status = readOptionalString(record.status);
    if (status && status !== 'active') {
      continue;
    }

    const value = `${providerId}/${modelId}`;
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);

    models.push({
      id: value,
      providerId,
      name: readOptionalString(record.name) ?? null,
      variants: Object.keys(readObjectRecord(record.variants) ?? {}),
    });
  }

  return models;
};

/**
 * Runs `opencode models --verbose` and parses its answer.
 *
 * Returns null when the CLI cannot produce a catalog - not installed, errored,
 * timed out, or unparseable - so the caller keeps an empty picker plus the
 * console warning rather than a list of models this install may not have. The
 * CLI is the single source of truth: it is the same resolver `opencode run`
 * uses, so it is also the only one that sees the user's own providers.
 */
const readOpenCodeCliModels = async (
  runModelsCli: () => Promise<string | null>,
): Promise<OpenCodeCliModel[] | null> => {
  const raw = await runModelsCli();
  if (raw === null) {
    return null;
  }

  const models = parseOpenCodeCliModels(raw);
  return models.length > 0 ? models : null;
};

const runOpenCodeModelsCli = async (): Promise<string | null> =>
  new Promise((resolve) => {
    let child: ReturnType<typeof crossSpawn>;
    try {
      child = crossSpawn('opencode', ['models', '--verbose'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (error) {
      console.warn('[OpenCode] `opencode models --verbose` failed to start:', error);
      resolve(null);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value: string | null, reason?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (value === null) {
        console.warn(
          '[OpenCode] `opencode models --verbose` unusable (%s). stderr: %s',
          reason ?? 'unknown',
          stderr.trim().slice(0, 400) || '(empty)',
        );
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // A dead child is exactly what the timeout wants anyway.
      }
      finish(null, 'timeout');
    }, OPENCODE_MODELS_CLI_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      console.warn('[OpenCode] `opencode models --verbose` spawn error:', error);
      finish(null, 'spawn-error');
    });
    child.on('close', (code) => {
      finish(code === 0 && stdout.trim() ? stdout : null, `exit=${code} stdout=${stdout.length}B`);
    });
  });

/**
 * Builds the picker catalog straight from the CLI answer.
 *
 * Labels and effort variants come from the CLI's own `name` and `variants`
 * fields; `description` carries the provider id, which is what makes a
 * `bit-openai/gpt-5.6-sol` entry distinguishable from an `openai/` one.
 */
const buildCatalogFromCli = (
  cliModels: OpenCodeCliModel[],
): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = cliModels.map((model) => {
    const effort = model.variants && model.variants.length > 0
      ? toOpenCodeEffort(model.variants)
      : undefined;
    return {
      value: model.id,
      label: model.name ?? model.id.split('/').slice(1).join('/'),
      description: model.providerId,
      ...(effort ? { effort } : {}),
    };
  });

  return {
    OPTIONS: options,
    DEFAULT: options.some((option) => option.value === OPENCODE_PREFERRED_DEFAULT)
      ? OPENCODE_PREFERRED_DEFAULT
      : options[0]?.value ?? '',
  };
};

const EMPTY_CATALOG: ProviderModelsDefinition = { OPTIONS: [], DEFAULT: '' };

/** Test seam: replaces the CLI invocation with a fixture-backed reader. */
export type OpenCodeProviderModelsDependencies = {
  runModelsCli?: () => Promise<string | null>;
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

/** Provider registry model adapter sourcing OpenCode models from the CLI. */
export class OpenCodeProviderModels implements IProviderModels {
  private readonly runModelsCli: () => Promise<string | null>;
  private liveCatalog: Promise<ProviderModelsDefinition | null> | null = null;
  private liveCatalogExpiresAt = 0;

  constructor(dependencies: OpenCodeProviderModelsDependencies = {}) {
    this.runModelsCli = dependencies.runModelsCli ?? runOpenCodeModelsCli;
  }

  /**
   * Reports the picker catalog from `opencode models --verbose`.
   *
   * The CLI is the only source that sees user-defined providers, but it costs
   * ~2s, so a successful answer is cached briefly and concurrent callers share
   * one in-flight run (the picker, the active-model lookup, and effort
   * validation all resolve the catalog within the same page load). A failed run
   * is not cached; the next caller retries rather than waiting out the TTL on a
   * null answer, and while it failed the picker is empty - serving a hardcoded
   * list would offer models this install cannot run.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (!this.liveCatalog || Date.now() >= this.liveCatalogExpiresAt) {
      const run = (async (): Promise<ProviderModelsDefinition | null> => {
        const cliModels = await readOpenCodeCliModels(this.runModelsCli);
        return cliModels ? buildCatalogFromCli(cliModels) : null;
      })();
      this.liveCatalog = run;
      this.liveCatalogExpiresAt = Date.now() + LIVE_CATALOG_TTL_MS;
      void run.catch(() => {
        if (this.liveCatalog === run) {
          this.liveCatalog = null;
          this.liveCatalogExpiresAt = 0;
        }
      });
    }

    return (await this.liveCatalog.catch(() => null)) ?? EMPTY_CATALOG;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    // OpenCode's `session` table is keyed by its own session id, so the stable
    // app id has to be translated first; sessions discovered on disk store the
    // provider id in both columns and resolve to themselves.
    const providerSessionId = sessionsDb.getSessionById(sessionId)?.provider_session_id ?? sessionId;

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
        `).get(providerSessionId) as {
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
      // Fall through to the catalog default when OpenCode session lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
