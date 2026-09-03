#!/usr/bin/env node
/**
 * Chat message-list scroll performance harness.
 *
 * Drives the real WebUI (default http://localhost:3001) in headless Chrome via
 * the Chrome DevTools Protocol and asserts on the three reported symptoms:
 *
 *   A. snapBack      — scroll up 40px (< the 60px bottom threshold), trigger an
 *                      unrelated re-render by typing into the composer, and
 *                      assert the viewport is NOT yanked back to the bottom.
 *   B. visualJump    — scroll deep into history, then measure how far the
 *                      topmost visible message drifts while content-visibility
 *                      placeholders are replaced by real heights. With native
 *                      scroll anchoring disabled this drifts; enabled it stays.
 *   C. scrollJank    — dispatch a burst of wheel events over the pane and count
 *                      long tasks on the main thread during the scroll window.
 *
 * Exit code 0 = all green, 1 = at least one red. `--save-baseline` writes the
 * measurements to chat-scroll-perf.baseline.json next to this script.
 *
 * Usage:
 *   node scripts/perf/chat-scroll-perf.mjs [--save-baseline]
 *        [--base-url http://localhost:3001] [--session <sessionId>]
 *        [--min-messages 40]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const betterSqlite3 = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE_URL = option('base-url', 'http://localhost:3001');
const MIN_MESSAGES = Number(option('min-messages', '40'));
const DEBUG_PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── CDP client ──────────────────────────────────────────────────────────────

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.eventHandlers = new Map();
    this.opened = new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message ?? 'CDP error'}`));
        else resolve(msg.result);
      } else if (msg.method !== undefined) {
        for (const fn of this.eventHandlers.get(msg.method) ?? []) fn(msg.params);
      }
    });
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP websocket closed'));
      this.pending.clear();
    });
  }

  async send(method, params = {}) {
    await this.opened;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, new Set());
    this.eventHandlers.get(method).add(fn);
  }

  waitEvent(method, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
      this.on(method, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails) {
      throw new Error(`page evaluate failed: ${result.exceptionDetails.text} ${
        result.exceptionDetails.exception?.description ?? ''
      }`);
    }
    return result.result.value;
  }
}

// ─── Setup helpers ───────────────────────────────────────────────────────────

function readAuthToken() {
  const dbPath = join(process.env.HOME, '.cloudcli', 'auth.db');
  if (!existsSync(dbPath)) throw new Error(`auth db not found at ${dbPath}`);
  const db = new betterSqlite3(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT value FROM app_config WHERE key = 'jwt_secret'").get();
    const user = db.prepare('SELECT id, username FROM users ORDER BY id LIMIT 1').get();
    if (!row || !user) throw new Error('jwt_secret or first user missing from auth.db');
    return jwt.sign({ userId: user.id, username: user.username }, row.value, { expiresIn: '2h' });
  } finally {
    db.close();
  }
}

async function api(path, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  const body = await res.json();
  return body.data ?? body;
}

async function pickLongestSession(token) {
  const recent = await api('/api/providers/sessions/recent?limit=50&offset=0', token);
  const conversations = recent.conversations ?? [];
  if (conversations.length === 0) throw new Error('no recent conversations found');
  let best = null;
  for (const conv of conversations) {
    try {
      const page = await api(
        `/api/providers/sessions/${encodeURIComponent(conv.sessionId)}/messages?limit=1&offset=0`,
        token,
      );
      const total = page.total ?? page.messages?.length ?? 0;
      if (!best || total > best.total) best = { sessionId: conv.sessionId, total, title: conv.sessionTitle };
    } catch {
      // skip sessions whose history cannot be fetched
    }
  }
  if (!best) throw new Error('no session history could be fetched');
  return best;
}

function launchChrome(profileDir) {
  const chrome = CHROME_CANDIDATES.find(existsSync);
  if (!chrome) throw new Error(`no Chrome binary found (tried ${CHROME_CANDIDATES.join(', ')})`);
  const child = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1400,900',
    'about:blank',
  ], { stdio: 'ignore' });
  child.on('error', (err) => { throw err; });
  return child;
}

async function waitForDebugEndpoint() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('chrome debug endpoint never became reachable');
}

async function openPageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target found in chrome');
  return new Cdp(new WebSocket(page.webSocketDebuggerUrl));
}

async function navigate(cdp, url) {
  const loaded = cdp.waitEvent('Page.loadEventFired', 30000).catch(() => null);
  await cdp.send('Page.navigate', { url });
  await loaded;
  await sleep(300);
}

// ─── Page-side helpers (injected as strings) ─────────────────────────────────

const PAGE_HELPERS = `
  window.__pane = () => document.querySelector('.chat-messages-pane');
  window.__composer = () => [...document.querySelectorAll('textarea')]
    .find((t) => t.offsetParent !== null && t.getBoundingClientRect().height > 20) ?? null;
  window.__typeInComposer = (ch) => {
    const ta = window.__composer();
    if (!ta) throw new Error('composer textarea not found');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ta.value + ch);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.__topVisibleMessage = () => {
    const c = window.__pane();
    const cr = c.getBoundingClientRect();
    const kids = [...c.querySelectorAll('.chat-message')];
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      if (r.bottom > cr.top + 2) return k;
    }
    return kids[0] ?? null;
  };
`;

async function waitForChatReady(cdp) {
  const deadline = Date.now() + 45000;
  let lastHeight = -1;
  let stableReads = 0;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = await cdp.evaluate(`(() => {
      const c = document.querySelector('.chat-messages-pane');
      if (!c) return { pane: false, path: location.pathname, title: document.title };
      return {
        pane: true,
        path: location.pathname,
        messages: document.querySelectorAll('.chat-message').length,
        scrollHeight: c.scrollHeight,
        clientHeight: c.clientHeight,
      };
    })()`);
    lastState = state;
    if (state?.pane && state.messages > 0 && state.scrollHeight - state.clientHeight > 200) {
      stableReads = state.scrollHeight === lastHeight ? stableReads + 1 : 0;
      lastHeight = state.scrollHeight;
      if (stableReads >= 3) return state;
    } else {
      stableReads = 0;
    }
    await sleep(300);
  }
  throw new Error(`chat pane never reached readiness; last state: ${JSON.stringify(lastState)}`);
}

/**
 * The server ships history in 20-message pages; scrolling to the top triggers
 * the load-older prepend path. Accumulate enough history that the scroll
 * tests exercise a realistically deep list.
 */
async function growHistory(cdp, { minHeight = 5000, maxRounds = 20 } = {}) {
  for (let round = 0; round < maxRounds; round++) {
    const state = await cdp.evaluate(`(() => {
      const c = window.__pane();
      c.scrollTop = 0;
      return {
        messages: document.querySelectorAll('.chat-message').length,
        scrollHeight: c.scrollHeight,
        clientHeight: c.clientHeight,
      };
    })()`);
    if (state.scrollHeight >= minHeight) return state;
    await sleep(800);
  }
  const state = await cdp.evaluate(`(() => ({
    messages: document.querySelectorAll('.chat-message').length,
    scrollHeight: window.__pane().scrollHeight,
  }))()`);
  if (state.scrollHeight < 2500) {
    throw new Error(`history growth stalled: ${JSON.stringify(state)}`);
  }
  return state;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testSnapBack(cdp) {
  const setup = await cdp.evaluate(`(async () => {
    const c = window.__pane();
    c.scrollTop = c.scrollHeight;
    await new Promise((r) => setTimeout(r, 150));
    return { max: c.scrollHeight - c.clientHeight };
  })()`, { awaitPromise: true });
  await cdp.evaluate(`(() => {
    const c = window.__pane();
    c.scrollTop = ${Math.max(setup.max - 40, 0)};
  })()`);
  await sleep(80);
  await cdp.evaluate(`window.__typeInComposer('x')`);
  await sleep(600);
  const after = await cdp.evaluate(`(() => {
    const c = window.__pane();
    return { scrollTop: c.scrollTop, max: c.scrollHeight - c.clientHeight };
  })()`);
  const distanceFromBottom = after.max - after.scrollTop;
  return {
    scrolledUpTo: setup.max - 40,
    scrollTopAfter: after.scrollTop,
    distanceFromBottom,
    snappedBack: distanceFromBottom < 5,
  };
}

async function testVisualJump(cdp) {
  const before = await cdp.evaluate(`(async () => {
    const c = window.__pane();
    c.scrollTop = Math.max(Math.floor(c.scrollHeight / 2) - Math.floor(c.clientHeight / 2), 0);
    await new Promise((r) => setTimeout(r, 150));
    const anchor = window.__topVisibleMessage();
    if (!anchor) throw new Error('no visible message anchor');
    return {
      scrollTop: c.scrollTop,
      anchorTop: anchor.getBoundingClientRect().top,
      anchorText: (anchor.textContent ?? '').slice(0, 40),
    };
  })()`, { awaitPromise: true });
  // Let content-visibility placeholders above the viewport resolve to real
  // heights; with native anchoring off this shifts the anchor visually.
  await sleep(1000);
  const mid = await cdp.evaluate(`(() => {
    const anchor = window.__topVisibleMessage();
    return { anchorTop: anchor.getBoundingClientRect().top, scrollTop: window.__pane().scrollTop };
  })()`);
  await cdp.evaluate(`window.__typeInComposer('y')`);
  await sleep(600);
  const after = await cdp.evaluate(`(() => {
    const anchor = window.__topVisibleMessage();
    return { anchorTop: anchor.getBoundingClientRect().top, scrollTop: window.__pane().scrollTop };
  })()`);
  const settleDrift = Math.abs(mid.anchorTop - before.anchorTop);
  const renderDrift = Math.abs(after.anchorTop - mid.anchorTop);
  return {
    scrollTopBefore: before.scrollTop,
    scrollTopMid: mid.scrollTop,
    scrollTopAfter: after.scrollTop,
    settleDriftPx: Number(settleDrift.toFixed(1)),
    renderDriftPx: Number(renderDrift.toFixed(1)),
    totalDriftPx: Number((settleDrift + renderDrift).toFixed(1)),
  };
}

async function testScrollJank(cdp) {
  await cdp.evaluate(`(() => {
    window.__longtasks = [];
    window.__longtaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longtasks.push({ duration: Math.round(entry.duration) });
      }
    });
    window.__longtaskObserver.observe({ entryTypes: ['longtask'] });
    // Frame-gap heartbeat: rAF timestamps recorded for the whole scroll burst.
    // Gaps larger than ~2 frames mean the main thread was blocked (jank).
    window.__frameTimestamps = [];
    const tick = () => {
      window.__frameTimestamps.push(performance.now());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const c = window.__pane();
    c.scrollTop = c.scrollHeight; // start at the bottom, scroll up through history
  })()`);
  await sleep(200);
  const paneCenter = await cdp.evaluate(`(() => {
    const r = window.__pane().getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const WHEEL_EVENTS = 40;
  for (let i = 0; i < WHEEL_EVENTS; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: paneCenter.x,
      y: paneCenter.y,
      deltaX: 0,
      deltaY: -120,
    });
    await sleep(40);
  }
  await sleep(600);
  const result = await cdp.evaluate(`(() => {
    window.__longtaskObserver?.disconnect();
    const stamps = window.__frameTimestamps;
    const gaps = [];
    for (let i = 1; i < stamps.length; i++) gaps.push(Math.round(stamps[i] - stamps[i - 1]));
    const sorted = [...gaps].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    return {
      scrollTopAfter: window.__pane().scrollTop,
      frameCount: gaps.length,
      frameGapP95Ms: p95,
      frameGapMaxMs: gaps.length ? Math.max(...gaps) : 0,
      droppedFrames: gaps.filter((g) => g > 50).length,
      longTaskCount: window.__longtasks.length,
      longTaskTotalMs: window.__longtasks.reduce((s, t) => s + t.duration, 0),
    };
  })()`);
  return { wheelEvents: WHEEL_EVENTS, ...result };
}

// Thresholds: generous noise margin, far below the broken baseline.
function verdicts(snap, jump, jank) {
  return {
    snapBack: { pass: !snap.snappedBack, detail: `distance from bottom after unrelated re-render: ${snap.distanceFromBottom}px (expect >= 5)` },
    visualJump: { pass: jump.totalDriftPx <= 8, detail: `anchor drift ${jump.totalDriftPx}px across 1s settle + re-render (expect <= 8)` },
    scrollJank: { pass: jank.frameGapP95Ms <= 40 && jank.frameGapMaxMs <= 150, detail: `frame gaps p95 ${jank.frameGapP95Ms}ms / max ${jank.frameGapMaxMs}ms, ${jank.droppedFrames} dropped during 40 wheel events (expect p95 <= 40, max <= 150)` },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const profileDir = mkdtempSync(join(tmpdir(), 'chat-scroll-perf-'));
const chrome = launchChrome(profileDir);
let cdp = null;
try {
  await waitForDebugEndpoint();
  cdp = await openPageTarget();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const token = readAuthToken();
  await navigate(cdp, `${BASE_URL}/`);
  await cdp.evaluate(`localStorage.setItem('auth-token', ${JSON.stringify(token)})`);

  const session = option('session', null)
    ? { sessionId: option('session', null), total: null }
    : await pickLongestSession(token);
  console.error(`[perf] target session: ${session.sessionId} (total=${session.total ?? 'n/a'})`);
  await navigate(cdp, `${BASE_URL}/session/${encodeURIComponent(session.sessionId)}`);
  await cdp.evaluate(PAGE_HELPERS);
  const ready = await waitForChatReady(cdp);
  const grown = await growHistory(cdp);
  console.error(`[perf] pane ready: ${ready.messages} rows (initial), after growth: ${grown.messages} rows, scrollHeight=${grown.scrollHeight}`);

  const snap = await testSnapBack(cdp);
  const jump = await testVisualJump(cdp);
  const jank = await testScrollJank(cdp);
  const verdict = verdicts(snap, jump, jank);

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    session: session.sessionId,
    messages: grown.messages,
    scrollHeight: grown.scrollHeight,
    snapBack: snap,
    visualJump: jump,
    scrollJank: jank,
    verdict,
  };
  console.log(JSON.stringify(report, null, 2));

  if (flag('save-baseline')) {
    const here = dirname(fileURLToPath(import.meta.url));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(here, 'chat-scroll-perf.baseline.json'), JSON.stringify(report, null, 2));
    console.error('[perf] baseline saved to scripts/perf/chat-scroll-perf.baseline.json');
  }

  const failed = Object.entries(verdict).filter(([, v]) => !v.pass);
  if (failed.length > 0) {
    console.error(`[perf] RED: ${failed.map(([k]) => k).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.error('[perf] GREEN: all checks passed');
  }
} catch (err) {
  console.error(`[perf] harness error: ${err.message}`);
  process.exitCode = 2;
} finally {
  try { cdp?.ws?.close(); } catch { /* ignore */ }
  chrome.kill('SIGTERM');
  await sleep(300);
  chrome.kill('SIGKILL');
  rmSync(profileDir, { recursive: true, force: true });
}
