/**
 * Phase 4 — Voyage AI embeddings client (voyage-3-lite).
 *
 * Used by topic-clusterer.js for the large-project (>=20 convos) HDBSCAN path.
 * Uses native fetch — no SDK dependency. Returns null gracefully when no
 * VOYAGE_API_KEY is set; the clusterer interprets null as "skip large-project
 * clustering, fall back to per-session Haiku tagging".
 */

const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const DEFAULT_MODEL = 'voyage-3-lite';
const REQUEST_TIMEOUT_MS = 30 * 1000;
const MAX_BATCH = 128;

function readKey() {
  const k = process.env.VOYAGE_API_KEY;
  return typeof k === 'string' && k.trim() ? k.trim() : null;
}

export function isAvailable() {
  return readKey() !== null;
}

async function postBatch(inputs, { model, signal }) {
  const apiKey = readKey();
  if (!apiKey) return null;
  const res = await fetch(VOYAGE_ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: inputs, model, input_type: 'document' }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Voyage HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json?.data || !Array.isArray(json.data)) {
    throw new Error('Voyage response missing data array');
  }
  return json.data
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding);
}

/**
 * Embed an array of text snippets. Splits into MAX_BATCH chunks and concatenates.
 * Returns null when no VOYAGE_API_KEY is configured (caller falls back).
 * Throws on transport / API errors so the caller can log + skip the run.
 */
export async function embed(texts, { model = DEFAULT_MODEL } = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  if (!isAvailable()) return null;

  const cleaned = texts.map((t) => (typeof t === 'string' ? t : '')).map((t) => t.slice(0, 4000));

  const out = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    for (let i = 0; i < cleaned.length; i += MAX_BATCH) {
      const batch = cleaned.slice(i, i + MAX_BATCH);
      const vecs = await postBatch(batch, { model, signal: controller.signal });
      if (!vecs) return null;
      out.push(...vecs);
    }
  } finally {
    clearTimeout(timer);
  }
  return out;
}

export const __internal = { VOYAGE_ENDPOINT, DEFAULT_MODEL, MAX_BATCH };
