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
        model: process.env.CLAUDE_HAIKU_MODEL || 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[USAGE] Rate limit probe failed (${res.status}): ${body}`);
    return null;
  }

  const get = (name) => res.headers.get(name);

  const sessionUtil = parseFloat(get('anthropic-ratelimit-unified-5h-utilization'));
  const weeklyUtil = parseFloat(get('anthropic-ratelimit-unified-7d-utilization'));
  const sessionReset = parseInt(get('anthropic-ratelimit-unified-5h-reset'), 10);
  const weeklyReset = parseInt(get('anthropic-ratelimit-unified-7d-reset'), 10);
  const sessionStatus = get('anthropic-ratelimit-unified-5h-status');
  const weeklyStatus = get('anthropic-ratelimit-unified-7d-status');

  return {
    session: {
      utilization: isNaN(sessionUtil) ? null : sessionUtil,
      percent: isNaN(sessionUtil) ? null : Math.round(sessionUtil * 100),
      resetAt: isNaN(sessionReset) ? null : sessionReset,
      status: sessionStatus || null,
    },
    weekly: {
      utilization: isNaN(weeklyUtil) ? null : weeklyUtil,
      percent: isNaN(weeklyUtil) ? null : Math.round(weeklyUtil * 100),
      resetAt: isNaN(weeklyReset) ? null : weeklyReset,
      status: weeklyStatus || null,
    },
  };
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
