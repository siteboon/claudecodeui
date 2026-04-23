/**
 * Phase 4 — topic clusterer.
 *
 * Two strategies:
 *  - Small project (<20 convos): per-session Haiku tagging. Cheap, picks an
 *    existing topic when one fits or invents a new 2-3 word label.
 *  - Large project (>=20 convos, VOYAGE_API_KEY available): batch-embed via
 *    Voyage voyage-3-lite, run a simple HDBSCAN-like single-linkage clustering
 *    over cosine distance, then ask Haiku to name each cluster from its top-5
 *    closest titles.
 *
 * Both strategies write to conversation_topics with a `method` column so the
 * nightly re-run can preserve `method='manual'` overrides.
 *
 * The Haiku call mirrors session-titler.js: prefer the direct SDK when an
 * ANTHROPIC_API_KEY is available, fall back to the Claude Agent SDK for
 * OAuth-only environments. Failures degrade gracefully to FALLBACK_TOPIC.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { sessionNamesDb } from '../database/db.js';
import { topicStore } from '../database/topic-store.js';

import {
  TOPIC_PROMPT_TEMPLATE,
  CLUSTER_NAMING_PROMPT,
  buildSessionContext,
  normalizeTopic,
  FALLBACK_TOPIC,
} from './topic-prompt.js';
import * as embeddings from './embeddings-client.js';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const TOPIC_MODEL = 'claude-haiku-4-5';
const PROVIDER = 'claude';
const CALL_TIMEOUT_MS = 30 * 1000;
const LARGE_PROJECT_THRESHOLD = 20;
const HDBSCAN_MIN_CLUSTER_SIZE = 3;
const COSINE_THRESHOLD = 0.62; // single-linkage cutoff for our HDBSCAN-lite path

const sdkState = {
  apiKey: null,
  apiKeyResolved: false,
  directLoader: null,
  agentLoader: null,
};

async function resolveApiKey() {
  if (sdkState.apiKeyResolved) return sdkState.apiKey;
  sdkState.apiKeyResolved = true;
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.trim()) {
    sdkState.apiKey = envKey.trim();
    return sdkState.apiKey;
  }
  try {
    const raw = await fsp.readFile(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const candidate = parsed?.env?.ANTHROPIC_API_KEY;
    if (typeof candidate === 'string' && candidate.trim()) {
      sdkState.apiKey = candidate.trim();
    }
  } catch {
    /* settings.json unreadable — fall back to agent SDK */
  }
  return sdkState.apiKey;
}

function loadDirectClient() {
  if (!sdkState.directLoader) {
    sdkState.directLoader = (async () => {
      const apiKey = await resolveApiKey();
      if (!apiKey) return null;
      try {
        const mod = await import('@anthropic-ai/sdk');
        const Anthropic = mod.default || mod.Anthropic;
        return new Anthropic({ apiKey });
      } catch (err) {
        console.warn('[topic-clusterer] Direct Anthropic SDK unavailable:', err?.message || err);
        return null;
      }
    })();
  }
  return sdkState.directLoader;
}

function loadAgentSdk() {
  if (!sdkState.agentLoader) {
    sdkState.agentLoader = import('@anthropic-ai/claude-agent-sdk')
      .then((mod) => mod.query)
      .catch((err) => {
        console.warn('[topic-clusterer] Failed to load Claude Agent SDK:', err?.message || err);
        return null;
      });
  }
  return sdkState.agentLoader;
}

async function callHaikuDirect(prompt) {
  const client = await loadDirectClient();
  if (!client) return null;
  try {
    const result = await client.messages.create({
      model: TOPIC_MODEL,
      max_tokens: 32,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = Array.isArray(result?.content)
      ? result.content.find((b) => b?.type === 'text')
      : null;
    return typeof block?.text === 'string' ? block.text : null;
  } catch (err) {
    console.warn('[topic-clusterer] Direct Haiku call failed:', err?.message || err);
    return null;
  }
}

async function callHaikuAgent(prompt) {
  const query = await loadAgentSdk();
  if (!query) return null;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CALL_TIMEOUT_MS);

  try {
    const instance = query({
      prompt,
      options: {
        model: TOPIC_MODEL,
        maxTurns: 1,
        tools: [],
        permissionMode: 'dontAsk',
        includePartialMessages: false,
        abortController: abort,
      },
    });

    for await (const msg of instance) {
      if (msg?.type === 'result') {
        if (msg.subtype === 'success' && typeof msg.result === 'string') {
          return msg.result;
        }
        return null;
      }
    }
    return null;
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn('[topic-clusterer] Agent Haiku call failed:', err?.message || err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callHaiku(prompt) {
  const apiKey = await resolveApiKey();
  if (apiKey) {
    const direct = await callHaikuDirect(prompt);
    if (direct) return direct;
  }
  return callHaikuAgent(prompt);
}

async function listProjectSlugs() {
  let entries;
  try {
    entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[topic-clusterer] Failed to list projects dir:', err.message);
    }
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listSessionsForSlug(slug) {
  const dir = path.join(PROJECTS_DIR, slug);
  let files;
  try {
    files = await fsp.readdir(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({
      id: f.replace(/\.jsonl$/, ''),
      filePath: path.join(dir, f),
    }));
}

function getKnownTitle(sessionId) {
  try {
    return sessionNamesDb.getName(sessionId, PROVIDER);
  } catch {
    return null;
  }
}

/**
 * Tag a single session with Haiku. Used both by the per-session hook (called
 * from session-titler events) and as a fallback when HDBSCAN is unavailable.
 * Returns the assigned topic name, or null on full failure.
 */
export async function tagSessionWithHaiku({ sessionId, slug, force = false }) {
  if (!sessionId || !slug) return null;
  const projectKey = slug;

  if (!force) {
    const existing = topicStore.getForSession(sessionId, PROVIDER);
    if (existing && existing.method === 'manual') return existing.topic;
  }

  const filePath = path.join(PROJECTS_DIR, slug, `${sessionId}.jsonl`);
  const firstMessage = await buildSessionContext(filePath, fsp);
  if (!firstMessage) return null;

  const title = getKnownTitle(sessionId);
  const existingTopics = topicStore.getTopicsForProject(projectKey).map((t) => t.name);
  const prompt = TOPIC_PROMPT_TEMPLATE({
    existingTopics,
    title: title || '(pending)',
    firstMessage,
  });

  const raw = await callHaiku(prompt);
  const topic = normalizeTopic(raw) || FALLBACK_TOPIC;

  try {
    return topicStore.setTopic({
      sessionId,
      provider: PROVIDER,
      projectKey,
      topic,
      method: 'haiku',
    }).topic;
  } catch (err) {
    console.warn(`[topic-clusterer] DB write failed for ${sessionId}: ${err.message}`);
    return null;
  }
}

/**
 * Catch-up tagging for a small project: tag every untagged session.
 * Returns the number of sessions newly tagged.
 */
export async function backfillSmallProject(slug) {
  const sessions = await listSessionsForSlug(slug);
  if (!sessions.length) return 0;
  const projectKey = slug;
  const tagged = topicStore.getTaggedSessionIds(projectKey);
  let count = 0;
  for (const s of sessions) {
    if (tagged.has(s.id)) continue;
    const topic = await tagSessionWithHaiku({ sessionId: s.id, slug });
    if (topic) count++;
  }
  return count;
}

// --- HDBSCAN-lite: single-linkage clustering over cosine distance ---

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.size = Array(n).fill(1);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.size[ra] < this.size[rb]) {
      this.parent[ra] = rb;
      this.size[rb] += this.size[ra];
    } else {
      this.parent[rb] = ra;
      this.size[ra] += this.size[rb];
    }
  }
}

/**
 * Cluster vectors using single-linkage: any two vectors with cosine similarity
 * > threshold land in the same cluster (transitively). Discards clusters
 * smaller than minClusterSize; their members become unclustered (-1).
 * Returns Map<clusterId, sessionIndex[]>; unclustered sessions land in
 * Map.get(-1).
 */
export function clusterVectors(vectors, { minClusterSize = HDBSCAN_MIN_CLUSTER_SIZE, threshold = COSINE_THRESHOLD } = {}) {
  const n = vectors.length;
  const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosine(vectors[i], vectors[j]) > threshold) {
        uf.union(i, j);
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  const out = new Map();
  let nextId = 0;
  const unclustered = [];
  for (const members of groups.values()) {
    if (members.length < minClusterSize) {
      unclustered.push(...members);
    } else {
      out.set(nextId++, members);
    }
  }
  if (unclustered.length) out.set(-1, unclustered);
  return out;
}

async function nameClusterWithHaiku({ existingTopics, sampleTitles }) {
  const prompt = CLUSTER_NAMING_PROMPT({ existingTopics, sampleTitles });
  const raw = await callHaiku(prompt);
  return normalizeTopic(raw);
}

/**
 * Compute the centroid of a cluster and pick the K titles closest to it.
 */
function pickRepresentativeTitles(memberIndices, vectors, sessions, k = 5) {
  if (!memberIndices.length) return [];
  const dim = vectors[memberIndices[0]].length;
  const centroid = new Float64Array(dim);
  for (const i of memberIndices) {
    const v = vectors[i];
    for (let d = 0; d < dim; d++) centroid[d] += v[d];
  }
  for (let d = 0; d < dim; d++) centroid[d] /= memberIndices.length;
  const ranked = memberIndices
    .map((i) => ({ i, sim: cosine(vectors[i], centroid) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k)
    .map((r) => sessions[r.i].title || sessions[r.i].snippet || '(untitled)');
  return ranked;
}

/**
 * Run HDBSCAN-lite for a project. Reads each session, embeds, clusters, names
 * clusters with Haiku, atomically replaces non-manual topic rows.
 *
 * Returns { method: 'hdbscan' | 'fallback' | 'skipped', clusterCount, taggedCount }.
 */
export async function clusterLargeProject(slug) {
  if (!embeddings.isAvailable()) {
    return { method: 'skipped', reason: 'no-voyage-key', clusterCount: 0, taggedCount: 0 };
  }
  const sessions = await listSessionsForSlug(slug);
  if (sessions.length < LARGE_PROJECT_THRESHOLD) {
    return { method: 'skipped', reason: 'below-threshold', clusterCount: 0, taggedCount: 0 };
  }

  const projectKey = slug;

  // Build text snippets (title + first message). Skip sessions with no readable
  // content — they keep their existing topic (or get tagged later when content arrives).
  const enriched = [];
  for (const s of sessions) {
    const firstMessage = await buildSessionContext(s.filePath, fsp);
    if (!firstMessage) continue;
    const title = getKnownTitle(s.id) || '';
    enriched.push({ ...s, title, snippet: firstMessage, text: `${title}\n${firstMessage}` });
  }
  if (enriched.length < LARGE_PROJECT_THRESHOLD) {
    return { method: 'skipped', reason: 'too-few-readable', clusterCount: 0, taggedCount: 0 };
  }

  let vectors;
  try {
    vectors = await embeddings.embed(enriched.map((e) => e.text));
  } catch (err) {
    console.warn(`[topic-clusterer] embed failed for ${slug}: ${err.message}`);
    vectors = null;
  }
  if (!vectors) {
    return { method: 'fallback', reason: 'embed-failed', clusterCount: 0, taggedCount: 0 };
  }

  const clusters = clusterVectors(vectors);
  const existingTopicsForNaming = topicStore
    .getTopicsForProject(projectKey)
    .map((t) => t.name);

  const assignments = [];
  let clusterCount = 0;
  for (const [clusterId, memberIndices] of clusters.entries()) {
    if (clusterId === -1) {
      // Unclustered (noise) — tag each one individually with Haiku later.
      continue;
    }
    const sampleTitles = pickRepresentativeTitles(memberIndices, vectors, enriched);
    let topicName = await nameClusterWithHaiku({
      existingTopics: existingTopicsForNaming,
      sampleTitles,
    });
    if (!topicName) topicName = FALLBACK_TOPIC;
    if (!existingTopicsForNaming.includes(topicName)) {
      existingTopicsForNaming.push(topicName);
    }
    const accent =
      topicStore.findAccentForTopic(projectKey, topicName) ||
      topicStore.pickAccentForProject(projectKey);
    for (const i of memberIndices) {
      assignments.push({
        sessionId: enriched[i].id,
        provider: PROVIDER,
        topic: topicName,
        accent,
        method: 'hdbscan',
      });
    }
    clusterCount++;
  }

  topicStore.replaceForProject(projectKey, assignments, { preserveManual: true });

  // Noise points: tag individually with Haiku so every session has exactly one topic.
  const noise = clusters.get(-1) || [];
  for (const i of noise) {
    await tagSessionWithHaiku({ sessionId: enriched[i].id, slug });
  }

  return {
    method: 'hdbscan',
    clusterCount,
    taggedCount: assignments.length + noise.length,
  };
}

/**
 * Single entry point for full re-clustering across ALL projects.
 * Used by the nightly cron and by the manual /api/topics/cluster endpoint.
 */
export async function clusterAllProjects() {
  const slugs = await listProjectSlugs();
  const summary = { large: 0, small: 0, skipped: 0, errors: 0, projects: [] };
  for (const slug of slugs) {
    try {
      const sessions = await listSessionsForSlug(slug);
      if (sessions.length === 0) {
        summary.skipped++;
        continue;
      }
      let result;
      if (sessions.length >= LARGE_PROJECT_THRESHOLD && embeddings.isAvailable()) {
        result = await clusterLargeProject(slug);
        summary.large++;
      } else {
        const newlyTagged = await backfillSmallProject(slug);
        result = { method: 'haiku', taggedCount: newlyTagged };
        summary.small++;
      }
      summary.projects.push({ slug, ...result });
    } catch (err) {
      summary.errors++;
      console.warn(`[topic-clusterer] project ${slug} failed: ${err.message}`);
    }
  }
  return summary;
}

/**
 * Manual override entry point (drag conversation onto a topic). Stores the
 * assignment with method='manual' so subsequent automatic runs don't overwrite.
 * Pass topic=null to clear a manual override.
 */
export function setManualTopic({ sessionId, slug, topic, provider = PROVIDER }) {
  if (!sessionId || !slug) {
    throw new Error('setManualTopic requires sessionId + slug');
  }
  if (topic === null || topic === undefined || (typeof topic === 'string' && !topic.trim())) {
    topicStore.clearForSession(sessionId, provider);
    return { cleared: true };
  }
  const trimmed = String(topic).trim();
  return topicStore.setTopic({
    sessionId,
    provider,
    projectKey: slug,
    topic: trimmed,
    method: 'manual',
  });
}

export const __internal = {
  callHaiku,
  listProjectSlugs,
  listSessionsForSlug,
  cosine,
  UnionFind,
  COSINE_THRESHOLD,
  LARGE_PROJECT_THRESHOLD,
};
