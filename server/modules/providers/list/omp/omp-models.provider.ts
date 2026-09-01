import crossSpawn from 'cross-spawn';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';

/**
 * Sentinel meaning "whatever omp's own config selects" — omp resolves the
 * effective model at runtime via `session/set_config_option`, so a user who
 * never picks a concrete model just lets omp decide.
 *
 * Consumed by the omp runtime provider and by `@/modules/agent`, both of which
 * must send no explicit model when the session carries the sentinel.
 */
export const OMP_CONFIGURED_MODEL_SENTINEL = '__omp_configured_model__';

const OMP_MODELS_TIMEOUT_MS = 15_000;

const SENTINEL_OPTION: ProviderModelOption = { value: OMP_CONFIGURED_MODEL_SENTINEL, label: 'Use omp default' };

// The catalog served when `omp models --json` cannot be read: omp still resolves
// a model itself, so the sentinel alone is a working catalog.
const OMP_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [SENTINEL_OPTION],
  DEFAULT: OMP_CONFIGURED_MODEL_SENTINEL,
};

const runOmpModelsCommand = (): Promise<string> => new Promise((resolve, reject) => {
  // Read OMP_PATH at call time so it stays overridable (matches the auth provider).
  const child = crossSpawn(process.env.OMP_PATH ?? 'omp', ['models', '--json'], { cwd: process.cwd(), env: { ...process.env } });
  let stdout = '';
  let settled = false;
  const finish = (error: Error | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error); else resolve(stdout);
  };
  const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('omp models timed out')); }, OMP_MODELS_TIMEOUT_MS);
  child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
  child.on('error', (e) => finish(e));
  child.on('close', (code) => finish(code === 0 ? null : new Error(`omp models exited with code ${code}`)));
});

/**
 * Parses `omp models --json` → catalog options (sentinel first).
 *
 * Exported as a test seam so the parse is asserted without spawning omp.
 */
export function parseOmpModels(stdout: string): ProviderModelsDefinition {
  const parsed = readObjectRecord(JSON.parse(stdout));
  const models = parsed && Array.isArray(parsed.models) ? parsed.models : [];
  const options: ProviderModelOption[] = [SENTINEL_OPTION];
  const seen = new Set<string>([OMP_CONFIGURED_MODEL_SENTINEL]);

  for (const raw of models) {
    const model = readObjectRecord(raw);
    const value = typeof model?.selector === 'string'
      ? model.selector
      : (typeof model?.id === 'string' ? model.id : null);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    // `thinking` is null OR this model's own level list, e.g. ["low","medium","high","max"].
    const thinking = Array.isArray(model?.thinking) ? model.thinking : [];
    options.push({
      value,
      label: typeof model?.name === 'string' ? model.name : value,
      description: value,
      ...(thinking.length > 0 ? { effort: { values: thinking.map((v) => ({ value: String(v) })) } } : {}),
    });
  }

  return { OPTIONS: options, DEFAULT: OMP_CONFIGURED_MODEL_SENTINEL };
}

/**
 * Reported when the catalog cannot say — omp absent, or a model it no longer lists.
 *
 * Consumed by the providers module's token-usage service, which must still
 * report a context window when the catalog read fails.
 */
export const OMP_FALLBACK_CONTEXT_WINDOW = 200_000;

/**
 * Per-model context windows from the same catalog, keyed `provider/id`.
 *
 * The bare model id is NOT unique across providers, and the difference is not
 * cosmetic: `claude-opus-5` is 1M through `anthropic` and 264k through
 * `github-copilot`. omp writes both fields on every assistant message it
 * records, so the key it is looked up by carries the provider too.
 */
function parseOmpContextWindows(stdout: string): Map<string, number> {
  const parsed = readObjectRecord(JSON.parse(stdout));
  const models = parsed && Array.isArray(parsed.models) ? parsed.models : [];
  const windows = new Map<string, number>();

  for (const raw of models) {
    const model = readObjectRecord(raw);
    const contextWindow = typeof model?.contextWindow === 'number' ? model.contextWindow : 0;
    if (contextWindow <= 0) continue;
    if (typeof model?.provider === 'string' && typeof model?.id === 'string') {
      windows.set(`${model.provider}/${model.id}`, contextWindow);
    }
    // Also by selector: `kilo/anthropic/claude-opus-5` has an id containing a
    // slash, so `provider/id` and the selector are the same string there, but
    // for the rest this is the key a caller holding a selector would use.
    if (typeof model?.selector === 'string') {
      windows.set(model.selector, contextWindow);
    }
  }

  return windows;
}

// The catalog only changes with the omp binary, and the exec costs ~1s, so it is
// read once per process. A failure is held for a short window rather than
// cleared: this runs at every turn end and on every REST token-usage read, and
// clearing it made an omp that is missing or hanging cost the full
// OMP_MODELS_TIMEOUT_MS on each one of them.
const CONTEXT_WINDOW_RETRY_MS = 60_000;
let contextWindowCache: Promise<Map<string, number>> | null = null;
let contextWindowRetryAt = 0;

/**
 * Context window for the model a recorded turn ran on; null when unlisted.
 *
 * Consumed by the providers module's token-usage service and by the omp runtime,
 * which reports the live context window at end of turn.
 */
export async function readOmpContextWindow(provider: string | null, model: string | null): Promise<number | null> {
  if (!provider || !model) return null;
  if (contextWindowRetryAt && Date.now() >= contextWindowRetryAt) {
    contextWindowCache = null;
    contextWindowRetryAt = 0;
  }
  if (!contextWindowCache) {
    contextWindowCache = runOmpModelsCommand()
      .then(parseOmpContextWindows)
      .catch(() => {
        contextWindowRetryAt = Date.now() + CONTEXT_WINDOW_RETRY_MS;
        return new Map<string, number>();
      });
  }
  return (await contextWindowCache).get(`${provider}/${model}`) ?? null;
}

// The IProviderModels half of the omp provider, consumed by `omp.provider.ts`.
export class OmpProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const definition = parseOmpModels(await runOmpModelsCommand());
      return definition.OPTIONS.length > 1 ? definition : OMP_FALLBACK_MODELS;
    } catch {
      return OMP_FALLBACK_MODELS;
    }
  }

  // omp's live current model comes from session/new configOptions (read by the
  // runtime). Statelessly here, just return the sentinel ("use omp default") —
  // no `omp models` exec needed.
  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return { model: OMP_CONFIGURED_MODEL_SENTINEL };
  }
}
