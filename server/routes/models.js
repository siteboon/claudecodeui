import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const router = express.Router();

// In-memory cache for model list
let cachedModels = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load ANTHROPIC_BASE_URL from ~/.claude/settings.json or environment.
 */
async function GetAnthropicBaseUrl() {
  if (process.env.ANTHROPIC_BASE_URL) {
    return process.env.ANTHROPIC_BASE_URL;
  }

  try {
    const settings_path = path.join(os.homedir(), '.claude', 'settings.json');
    const content = await fs.readFile(settings_path, 'utf8');
    const settings = JSON.parse(content);

    if (settings?.env?.ANTHROPIC_BASE_URL) {
      return settings.env.ANTHROPIC_BASE_URL;
    }
  } catch {
    // settings.json not found or malformed
  }

  return null;
}

/**
 * Fetch available models from the API proxy.
 */
async function FetchModelsFromProxy() {
  const now = Date.now();
  if (cachedModels && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedModels;
  }

  const base_url = await GetAnthropicBaseUrl();
  if (!base_url) {
    return null;
  }

  const url = `${base_url.replace(/\/+$/, '')}/v1/models`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Models API returned ${response.status}`);
  }

  const data = await response.json();

  if (!data?.data || !Array.isArray(data.data)) {
    throw new Error('Invalid models response format');
  }

  // Filter out embedding models and group by provider
  const chat_models = data.data.filter(
    (m) => !m.id.includes('embedding') && !m.id.includes('ada-002')
  );

  const result = {
    models: chat_models.map((m) => ({
      id: m.id,
      name: m.display_name || m.id,
      provider: m.owned_by || 'unknown',
    })),
    fetched_at: now,
  };

  cachedModels = result;
  cacheTimestamp = now;

  return result;
}

/**
 * GET /api/models
 * Returns available models from the API proxy, grouped by provider.
 */
router.get('/', async (_req, res) => {
  try {
    const result = await FetchModelsFromProxy();

    if (!result) {
      return res.json({
        success: false,
        dynamic: false,
        message: 'No ANTHROPIC_BASE_URL configured, using static model list',
      });
    }

    // Group models by provider for the frontend
    const grouped = {};
    for (const model of result.models) {
      const provider_key = model.provider.toLowerCase();
      if (!grouped[provider_key]) {
        grouped[provider_key] = [];
      }
      grouped[provider_key].push({
        value: model.id,
        label: model.name,
      });
    }

    return res.json({
      success: true,
      dynamic: true,
      models: result.models,
      grouped,
      fetched_at: result.fetched_at,
    });
  } catch (error) {
    console.error('Error fetching models:', error.message);
    return res.status(500).json({
      success: false,
      dynamic: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/models/refresh
 * Force refresh the cached models.
 */
router.post('/refresh', async (_req, res) => {
  try {
    cachedModels = null;
    cacheTimestamp = 0;
    const result = await FetchModelsFromProxy();

    if (!result) {
      return res.json({ success: false, message: 'No ANTHROPIC_BASE_URL configured' });
    }

    return res.json({ success: true, count: result.models.length });
  } catch (error) {
    console.error('Error refreshing models:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
