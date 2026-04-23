/**
 * Phase 4 — topic clusterer scheduler.
 *
 * Two triggers:
 *  1. Nightly at 3am local — full re-cluster of every project (large projects
 *     get HDBSCAN, small projects get a Haiku catch-up pass for any untagged
 *     sessions).
 *  2. Per-session: subscribes to `titlerEvents.on('titled')` so a freshly
 *     titled conversation gets its topic assigned within seconds.
 *
 * Self-starts on import so server/index.js only needs a bare `import` line.
 * Implementation notes:
 *  - We avoid the node-cron dependency (not currently in package.json) and
 *    use a setTimeout that re-arms itself after each fire. This is the
 *    standard "next tick at 3am" pattern and survives DST transitions
 *    because we re-compute the next 3am after each run.
 *  - The per-session hook is debounced per sessionId to coalesce rapid
 *    title rewrites.
 */

import { titlerEvents } from './session-titler.js';
import { tagSessionWithHaiku, clusterAllProjects } from './topic-clusterer.js';

const PER_SESSION_DEBOUNCE_MS = 5 * 1000;
const NIGHTLY_HOUR = 3;

const state = {
  started: false,
  nightlyTimer: null,
  perSessionTimers: new Map(),
  inflight: new Set(),
};

function nextNightlyDelayMs(now = new Date()) {
  const target = new Date(now);
  target.setHours(NIGHTLY_HOUR, 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function scheduleNightly() {
  const delay = nextNightlyDelayMs();
  state.nightlyTimer = setTimeout(async () => {
    try {
      const summary = await clusterAllProjects();
      console.log(
        `[topic-clusterer] nightly run: large=${summary.large} small=${summary.small} ` +
          `skipped=${summary.skipped} errors=${summary.errors}`,
      );
    } catch (err) {
      console.warn(`[topic-clusterer] nightly run failed: ${err.message}`);
    } finally {
      scheduleNightly();
    }
  }, delay);
  if (state.nightlyTimer && typeof state.nightlyTimer.unref === 'function') {
    state.nightlyTimer.unref();
  }
}

function onTitled(payload) {
  if (!payload?.sessionId || !payload?.slug) return;
  const key = `${payload.slug}::${payload.sessionId}`;
  if (state.inflight.has(key)) return;
  const existing = state.perSessionTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    state.perSessionTimers.delete(key);
    state.inflight.add(key);
    try {
      await tagSessionWithHaiku({ sessionId: payload.sessionId, slug: payload.slug });
    } catch (err) {
      console.warn(`[topic-clusterer] per-session tag failed for ${payload.sessionId}: ${err.message}`);
    } finally {
      state.inflight.delete(key);
    }
  }, PER_SESSION_DEBOUNCE_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
  state.perSessionTimers.set(key, timer);
}

export function start() {
  if (state.started) return;
  state.started = true;
  titlerEvents.on('titled', onTitled);
  scheduleNightly();
  console.log(
    `[topic-clusterer] started (nightly at ${NIGHTLY_HOUR}:00 local; per-session via titler)`,
  );
}

export function stop() {
  if (!state.started) return;
  state.started = false;
  titlerEvents.off('titled', onTitled);
  if (state.nightlyTimer) {
    clearTimeout(state.nightlyTimer);
    state.nightlyTimer = null;
  }
  for (const t of state.perSessionTimers.values()) clearTimeout(t);
  state.perSessionTimers.clear();
  state.inflight.clear();
}

start();

export const __internal = { state, nextNightlyDelayMs, onTitled };
