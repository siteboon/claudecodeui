/**
 * Auto-naming worker for Claude sessions.
 *
 * Watches `~/.claude/projects/**\/*.jsonl`, waits 60s of idle per file, then
 * asks Haiku for a 3-5 word title and stores the result in the existing
 * `session_names.custom_name` column (provider='claude'). Backfills any
 * already-present JSONL on boot.
 *
 * Self-starts on import so server/index.js only needs a bare `import` line.
 * Exports `start` / `stop` for tests and orderly shutdown.
 */

import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { sessionNamesDb } from '../database/db.js';

import { TITLE_PROMPT, extractFirstUserTexts, normalizeTitle } from './title-prompt.js';

/**
 * Phase 4 hookpoint: subscribers (e.g. topic-clusterer) get a 'titled' event
 * whenever a session receives a fresh custom_name. Payload:
 *   { sessionId, provider, title, filePath, slug }
 *
 * Failures in subscribers must not affect titling; emit() is wrapped.
 */
export const titlerEvents = new EventEmitter();
titlerEvents.setMaxListeners(20);

function emitTitled(payload) {
  try {
    titlerEvents.emit('titled', payload);
  } catch (err) {
    console.warn('[session-titler] titlerEvents subscriber threw:', err?.message || err);
  }
}

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const DEBOUNCE_MS = 60 * 1000;
const MAX_CONTENT_CHARS = 1500;
const CALL_TIMEOUT_MS = 30 * 1000;
const TITLE_MODEL = 'claude-haiku-4-5';
const PROVIDER = 'claude';
const DEFAULT_TITLE = 'Untitled';

const state = {
  started: false,
  watcher: null,
  debounceTimers: new Map(),
  queue: [],
  queued: new Set(),
  processing: false,
  sdkLoader: null,
  directClientLoader: null,
  apiKeyResolved: false,
  apiKey: null,
};

async function resolveApiKey() {
  if (state.apiKeyResolved) return state.apiKey;
  state.apiKeyResolved = true;
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.trim()) {
    state.apiKey = envKey.trim();
    return state.apiKey;
  }
  try {
    const raw = await fsp.readFile(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const candidate = parsed?.env?.ANTHROPIC_API_KEY;
    if (typeof candidate === 'string' && candidate.trim()) {
      state.apiKey = candidate.trim();
    }
  } catch {
    /* settings.json absent or unparseable — fine, we'll fall back */
  }
  return state.apiKey;
}

function loadDirectClient() {
  if (!state.directClientLoader) {
    state.directClientLoader = (async () => {
      const apiKey = await resolveApiKey();
      if (!apiKey) return null;
      try {
        const mod = await import('@anthropic-ai/sdk');
        const Anthropic = mod.default || mod.Anthropic;
        return new Anthropic({ apiKey });
      } catch (err) {
        console.warn('[session-titler] Direct Anthropic SDK unavailable:', err?.message || err);
        return null;
      }
    })();
  }
  return state.directClientLoader;
}

function loadAgentSdk() {
  if (!state.sdkLoader) {
    state.sdkLoader = import('@anthropic-ai/claude-agent-sdk')
      .then((mod) => mod.query)
      .catch((err) => {
        console.warn('[session-titler] Failed to load Claude Agent SDK:', err?.message || err);
        return null;
      });
  }
  return state.sdkLoader;
}

function sessionIdFromPath(filePath) {
  return path.basename(filePath, '.jsonl');
}

async function buildTitlingInput(filePath) {
  let content;
  try {
    content = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    console.warn(`[session-titler] Failed to read ${filePath}: ${err.message}`);
    return null;
  }
  const lines = content.split('\n');
  const texts = extractFirstUserTexts(lines, 2);
  if (!texts.length) return null;
  return texts.join('\n\n').slice(0, MAX_CONTENT_CHARS);
}

async function callHaikuDirect(prompt) {
  const client = await loadDirectClient();
  if (!client) return null;
  try {
    const result = await client.messages.create({
      model: TITLE_MODEL,
      max_tokens: 20,
      system: TITLE_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = Array.isArray(result?.content)
      ? result.content.find((b) => b?.type === 'text')
      : null;
    return typeof block?.text === 'string' ? block.text : null;
  } catch (err) {
    console.warn('[session-titler] Direct Haiku call failed:', err?.message || err);
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
        model: TITLE_MODEL,
        systemPrompt: TITLE_PROMPT,
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
      console.warn('[session-titler] Agent Haiku call failed:', err?.message || err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Prefer the direct SDK when an API key is available (faster, no subprocess).
// Fall back to the Claude Agent SDK for OAuth-only environments.
async function callHaiku(prompt) {
  const apiKey = await resolveApiKey();
  if (apiKey) {
    const direct = await callHaikuDirect(prompt);
    if (direct) return direct;
  }
  return callHaikuAgent(prompt);
}

/**
 * Appends a trailing newline to the JSONL after a successful title write. The
 * existing projects watcher in server/index.js treats this as a change event
 * and re-broadcasts `projects_updated`, which makes the new custom_name flow
 * through to the sidebar live. JSONL readers skip blank lines so this is a
 * semantic no-op.
 */
async function signalUpdate(filePath) {
  try {
    await fsp.appendFile(filePath, '\n');
  } catch (err) {
    console.warn(`[session-titler] Failed to signal update for ${filePath}: ${err.message}`);
  }
}

async function processTitle(filePath) {
  const sessionId = sessionIdFromPath(filePath);
  try {
    if (sessionNamesDb.getName(sessionId, PROVIDER)) return;
  } catch (err) {
    console.warn(`[session-titler] DB lookup failed for ${sessionId}: ${err.message}`);
    return;
  }

  const input = await buildTitlingInput(filePath);
  if (!input) return;

  const raw = await callHaiku(input);
  // `null` means both the direct and agent paths failed (no auth, offline, etc.).
  // Leave the session pendingTitle=true so we retry when credentials recover.
  if (raw === null) return;
  const title = normalizeTitle(raw) || DEFAULT_TITLE;

  try {
    sessionNamesDb.setName(sessionId, PROVIDER, title);
  } catch (err) {
    console.warn(`[session-titler] Failed to save title for ${sessionId}: ${err.message}`);
    return;
  }

  emitTitled({
    sessionId,
    provider: PROVIDER,
    title,
    filePath,
    slug: path.basename(path.dirname(filePath)),
  });

  await signalUpdate(filePath);
}

async function runQueue() {
  if (state.processing) return;
  state.processing = true;
  try {
    while (state.queue.length) {
      const filePath = state.queue.shift();
      state.queued.delete(filePath);
      try {
        await processTitle(filePath);
      } catch (err) {
        console.warn(`[session-titler] processTitle threw for ${filePath}: ${err.message}`);
      }
    }
  } finally {
    state.processing = false;
  }
}

function enqueue(filePath) {
  if (state.queued.has(filePath)) return;
  state.queued.add(filePath);
  state.queue.push(filePath);
  runQueue().catch((err) => console.warn('[session-titler] Queue error:', err.message));
}

function scheduleTitle(filePath) {
  const existing = state.debounceTimers.get(filePath);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    state.debounceTimers.delete(filePath);
    enqueue(filePath);
  }, DEBOUNCE_MS);
  state.debounceTimers.set(filePath, timer);
}

async function scanExistingFiles() {
  let entries;
  try {
    entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[session-titler] Scan failed:', err.message);
    }
    return;
  }

  let enqueued = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slugDir = path.join(PROJECTS_DIR, entry.name);
    let files;
    try {
      files = await fsp.readdir(slugDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const sessionId = f.replace(/\.jsonl$/, '');
      try {
        if (sessionNamesDb.getName(sessionId, PROVIDER)) continue;
      } catch {
        continue;
      }
      enqueue(path.join(slugDir, f));
      enqueued++;
    }
  }

  if (enqueued) {
    console.log(`[session-titler] Backfilling ${enqueued} session title(s)`);
  }
}

async function setupWatcher() {
  let chokidarModule;
  try {
    chokidarModule = await import('chokidar');
  } catch (err) {
    console.warn('[session-titler] chokidar unavailable:', err.message);
    return;
  }

  try {
    state.watcher = chokidarModule.default.watch(PROJECTS_DIR, {
      ignored: ['**/*.tmp', '**/*.swp', '**/.DS_Store'],
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      depth: 10,
    });

    const onEvent = (filePath) => {
      if (!filePath.endsWith('.jsonl')) return;
      scheduleTitle(filePath);
    };

    state.watcher
      .on('add', onEvent)
      .on('change', onEvent)
      .on('error', (err) => console.warn('[session-titler] Watcher error:', err.message));
  } catch (err) {
    console.warn('[session-titler] Failed to set up watcher:', err.message);
  }
}

export async function start() {
  if (state.started) return;
  state.started = true;
  try {
    await fsp.mkdir(PROJECTS_DIR, { recursive: true });
  } catch (err) {
    console.warn('[session-titler] Failed to ensure projects dir:', err.message);
    return;
  }
  await setupWatcher();
  scanExistingFiles().catch((err) =>
    console.warn('[session-titler] Initial scan failed:', err.message),
  );
}

export async function stop() {
  if (!state.started) return;
  state.started = false;
  if (state.watcher) {
    try {
      await state.watcher.close();
    } catch {
      /* ignore */
    }
    state.watcher = null;
  }
  for (const timer of state.debounceTimers.values()) clearTimeout(timer);
  state.debounceTimers.clear();
  state.queue.length = 0;
  state.queued.clear();
}

start().catch((err) => console.warn('[session-titler] Start failed:', err?.message || err));

export const __internal = {
  state,
  buildTitlingInput,
  callHaiku,
  processTitle,
  enqueue,
  scheduleTitle,
};
