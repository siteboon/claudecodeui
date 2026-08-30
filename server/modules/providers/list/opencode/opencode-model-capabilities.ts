import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * What a model actually accepts, so a settings page does not offer a knob the
 * provider rejects.
 *
 * The values are per model, not per provider: of the 7,488 models in the
 * catalog, 1,344 refuse a temperature - every Anthropic model among them
 * (`temperature: false` on claude-opus-4-8, claude-sonnet-5 and the rest),
 * while gpt-4o accepts one. `limit.output` is the ceiling for an answer.
 *
 * The source is the catalog OpenCode itself keeps at
 * `~/.cache/opencode/models.json` (a copy of models.dev, refreshed by OpenCode).
 * Reading that file costs nothing and needs no network; a model that is not in
 * it - a local Ollama, for instance - has no published capabilities, and the
 * caller decides what to do with that.
 */

export type ModelCapabilities = {
  /** Whether the model takes a sampling temperature at all. */
  temperature: boolean;
  /** Largest answer the model will produce, in tokens. */
  maxOutput?: number;
  /** Context window, in tokens. */
  contextLimit?: number;
  /** Whether the model reasons before answering. */
  reasoning: boolean;
};

type CatalogModel = {
  temperature?: unknown;
  reasoning?: unknown;
  limit?: { context?: unknown; output?: unknown };
};

type Catalog = Record<string, { models?: Record<string, CatalogModel> }>;

function getCatalogPath(): string {
  return process.env.CLOUDCLI_OPENCODE_CATALOG
    || path.join(os.homedir(), '.cache', 'opencode', 'models.json');
}

/**
 * The catalog is ~4.4 MB, so it is parsed once and re-read only when the file
 * changes. OpenCode refreshes it in the background.
 */
let cached: { catalog: Catalog; mtimeMs: number } | null = null;

async function readCatalog(): Promise<Catalog> {
  const target = getCatalogPath();

  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(target)).mtimeMs;
  } catch {
    // No OpenCode installation, or it has not fetched the catalog yet.
    return {};
  }

  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.catalog;
  }

  try {
    const parsed = JSON.parse(await fs.readFile(target, 'utf8')) as Catalog;
    cached = { catalog: parsed && typeof parsed === 'object' ? parsed : {}, mtimeMs };
    return cached.catalog;
  } catch {
    return {};
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Capabilities for the given routed model ids (`<providerID>/<modelID>`).
 * Ids the catalog does not know are left out.
 */
export async function readModelCapabilities(
  modelValues: string[],
): Promise<Record<string, ModelCapabilities>> {
  if (modelValues.length === 0) {
    return {};
  }

  const catalog = await readCatalog();
  const capabilities: Record<string, ModelCapabilities> = {};

  for (const value of modelValues) {
    const separator = value.indexOf('/');
    if (separator <= 0) {
      continue;
    }

    const model = catalog[value.slice(0, separator)]?.models?.[value.slice(separator + 1)];
    if (!model) {
      continue;
    }

    capabilities[value] = {
      temperature: model.temperature !== false,
      maxOutput: asNumber(model.limit?.output),
      contextLimit: asNumber(model.limit?.context),
      reasoning: model.reasoning === true,
    };
  }

  return capabilities;
}

/** Drops the parsed catalog so the next call reads the file again. For tests. */
export function resetModelCapabilityCache(): void {
  cached = null;
}
