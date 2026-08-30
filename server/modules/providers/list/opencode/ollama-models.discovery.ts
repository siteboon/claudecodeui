import type { ProviderModelOption } from '@/shared/types.js';

/**
 * Lists the models a local Ollama instance actually has, for the OpenCode
 * catalog.
 *
 * OpenCode routes by `<providerID>/<modelID>` and can address Ollama, but the
 * curated catalog cannot know which models are pulled on this machine - that
 * changes with every `ollama pull`. Asking Ollama is the only way to show them
 * all, and it is a local call: `GET /api/tags` on a service that is either
 * running on this machine or not there at all.
 *
 * Deliberately soft: any failure (Ollama not installed, not running, a
 * timeout) yields an empty list, so the catalog is exactly what it was before.
 */

/**
 * Where Ollama listens. `OLLAMA_HOST` is Ollama's own variable and may come
 * without a scheme (`127.0.0.1:11434`), which is why it is normalized here.
 *
 * The default is `127.0.0.1`, never `localhost`: on Windows the name resolves
 * to `::1` first, Ollama listens on IPv4 only, and every connection pays the
 * failed IPv6 attempt - measured at ~2.9 s per call against ~0.8 s.
 */
function getOllamaBaseUrl(): string {
  const configured = (process.env.CLOUDCLI_OLLAMA_URL || process.env.OLLAMA_HOST || '').trim();
  if (!configured) {
    return 'http://127.0.0.1:11434';
  }

  const withScheme = /^https?:\/\//i.test(configured) ? configured : `http://${configured}`;
  return withScheme.replace(/\/+$/, '');
}

/** How long a probe may take before the catalog is served without Ollama. */
const PROBE_TIMEOUT_MS = 1500;

/**
 * Models cannot change while a request is in flight, but the catalog is read
 * often (every model dropdown). A short cache keeps that from turning into a
 * request per render, while a newly pulled model still shows up promptly.
 */
const CACHE_TTL_MS = 30_000;

type OllamaTag = {
  name?: unknown;
  model?: unknown;
  details?: {
    parameter_size?: unknown;
    family?: unknown;
  };
};

let cachedOptions: ProviderModelOption[] = [];
let cachedAt = 0;

/**
 * Embedding models answer no prompts, so they are left out of a chat model
 * list. Ollama does not flag them, but their family is a BERT variant and
 * their name says so - both are checked, either is enough.
 */
function isEmbeddingModel(name: string, family: string): boolean {
  return /embed/i.test(name) || /bert/i.test(family);
}

function toOption(tag: OllamaTag): ProviderModelOption | null {
  const name = typeof tag.name === 'string' && tag.name.trim()
    ? tag.name.trim()
    : typeof tag.model === 'string' ? tag.model.trim() : '';
  if (!name) {
    return null;
  }

  const family = typeof tag.details?.family === 'string' ? tag.details.family : '';
  if (isEmbeddingModel(name, family)) {
    return null;
  }

  const size = typeof tag.details?.parameter_size === 'string' ? tag.details.parameter_size : '';

  return {
    // The prefix is what OpenCode routes on; without it the id is ambiguous.
    value: `ollama/${name}`,
    label: size ? `${name} (${size})` : name,
    description: 'Ollama, local',
  };
}

/**
 * Models available from the local Ollama instance, or an empty list when it
 * cannot be reached. Never throws.
 */
export async function discoverOllamaModels(): Promise<ProviderModelOption[]> {
  if (Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedOptions;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, { signal: controller.signal });
    if (!response.ok) {
      cachedOptions = [];
      cachedAt = Date.now();
      return cachedOptions;
    }

    const payload = await response.json() as { models?: OllamaTag[] };
    const options = Array.isArray(payload?.models)
      ? payload.models.map(toOption).filter((option): option is ProviderModelOption => option !== null)
      : [];

    options.sort((a, b) => a.value.localeCompare(b.value));
    cachedOptions = options;
    cachedAt = Date.now();
    return cachedOptions;
  } catch {
    // Not installed, not running, or too slow to answer - all the same here.
    cachedOptions = [];
    cachedAt = Date.now();
    return cachedOptions;
  } finally {
    clearTimeout(timeout);
  }
}

/** Drops the cache so the next call probes again. For tests. */
export function resetOllamaModelCache(): void {
  cachedOptions = [];
  cachedAt = 0;
}
