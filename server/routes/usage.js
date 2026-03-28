import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const router = express.Router();

/** Reads Claude OAuth credentials from ~/.claude/.credentials.json. */
async function getSubscriptionInfo() {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);
    const oauth = creds.claudeAiOauth;
    if (!oauth) return null;
    return {
      subscriptionType: oauth.subscriptionType || null,
      rateLimitTier: oauth.rateLimitTier || null,
      accessToken: oauth.accessToken || null,
    };
  } catch {
    return null;
  }
}

/**
 * Makes a minimal API call to get rate limit headers from Anthropic.
 * Uses the cheapest model (Haiku) with minimal tokens.
 */
async function fetchRateLimits(accessToken) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': accessToken,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  // Collect rate-limit headers from ANY response (even 404/429) —
  // Anthropic includes them regardless of status code, so we don't
  // depend on any specific model staying valid.
  const rlHeaders = {};
  for (const [key, value] of res.headers.entries()) {
    if (key.startsWith('anthropic-ratelimit-')) {
      rlHeaders[key] = value;
    }
  }
  // Drain the response body so the TCP connection can be reused
  await res.text().catch(() => '');

  console.debug('[USAGE] Rate limit headers:', rlHeaders);

  // 1. Try unified utilization headers (Max, Team, Enterprise plans)
  const unified = parseUnifiedHeaders(rlHeaders);
  if (unified) return unified;

  // 2. Fall back to standard limit/remaining headers (Pro, Free plans)
  const standard = parseStandardHeaders(rlHeaders);
  if (standard) return standard;

  console.warn('[USAGE] No recognised rate limit headers in response');
  return null;
}

/**
 * Discovers unified rate-limit windows (e.g. "5h", "7d") from response headers.
 * These are returned for plans with a single shared pool across all models.
 */
function parseUnifiedHeaders(headers) {
  const windows = new Set();
  for (const key of Object.keys(headers)) {
    const m = key.match(/^anthropic-ratelimit-unified-(.+?)-(utilization|reset|status)$/);
    if (m) windows.add(m[1]);
  }
  if (windows.size === 0) return null;

  const periods = [];
  for (const w of windows) {
    const util = parseFloat(headers[`anthropic-ratelimit-unified-${w}-utilization`]);
    const reset = parseInt(headers[`anthropic-ratelimit-unified-${w}-reset`], 10);
    const status = headers[`anthropic-ratelimit-unified-${w}-status`] || null;
    if (!isNaN(util)) {
      periods.push({
        key: w,
        percent: Math.round(util * 100),
        resetAt: isNaN(reset) ? null : reset,
        status,
      });
    }
  }
  if (periods.length === 0) return null;

  // Sort shorter windows first (session before weekly)
  periods.sort((a, b) => windowToSeconds(a.key) - windowToSeconds(b.key));
  return { type: 'unified', periods };
}

const WINDOW_RE = /^(\d+)(m|h|d|w)$/;
const WINDOW_MULTIPLIERS = { m: 60, h: 3600, d: 86400, w: 604800 };

/** Converts a window suffix like "5h" or "7d" to seconds for sorting. */
function windowToSeconds(w) {
  const m = WINDOW_RE.exec(w);
  if (!m) return 0;
  return parseInt(m[1], 10) * (WINDOW_MULTIPLIERS[m[2]] || 0);
}

/**
 * Parses standard per-minute rate-limit headers (limit / remaining / reset).
 * These are returned for all API users including Pro and Free plans.
 */
function parseStandardHeaders(headers) {
  const dimensions = ['tokens', 'requests', 'input-tokens', 'output-tokens'];
  const periods = [];

  for (const dim of dimensions) {
    const limit = parseInt(headers[`anthropic-ratelimit-${dim}-limit`], 10);
    const remaining = parseInt(headers[`anthropic-ratelimit-${dim}-remaining`], 10);
    const resetStr = headers[`anthropic-ratelimit-${dim}-reset`];

    if (isNaN(limit) || isNaN(remaining) || limit <= 0) continue;

    const percent = Math.round(((limit - remaining) / limit) * 100);
    let resetAt = null;
    if (resetStr) {
      const d = new Date(resetStr);
      if (!isNaN(d.getTime())) resetAt = Math.floor(d.getTime() / 1000);
    }

    periods.push({
      key: dim,
      percent,
      resetAt,
      status: null,
      limit,
      remaining,
    });
  }
  if (periods.length === 0) return null;
  return { type: 'standard', periods };
}


/** Maps a subscription type key to a display-friendly plan name. */
function formatPlanName(type) {
  const names = { free: 'Free', pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' };
  return names[type] || type || 'Unknown';
}

/**
 * GET /api/usage/current
 * Returns real rate limits from Anthropic API + plan info.
 */
router.get('/current', async (req, res) => {
  try {
    const subInfo = await getSubscriptionInfo();

    let rateLimits = null;
    if (subInfo?.accessToken) {
      try {
        rateLimits = await fetchRateLimits(subInfo.accessToken);
      } catch (e) {
        console.error('Rate limit fetch failed:', e.message);
      }
    }

    res.json({
      plan: subInfo ? formatPlanName(subInfo.subscriptionType) : null,
      rateLimitTier: subInfo?.rateLimitTier || null,
      rateLimits,
    });
  } catch (error) {
    console.error('Error fetching usage data:', error.message);
    res.status(500).json({ error: 'Failed to fetch usage data' });
  }
});

export default router;
