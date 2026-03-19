/**
 * Provider Registry
 *
 * Centralizes provider adapter lookup. All code that needs a provider adapter
 * should go through this registry instead of importing individual adapters directly.
 *
 * @module providers/registry
 */

import { claudeAdapter } from './claude/adapter.js';
import { cursorAdapter } from './cursor/adapter.js';
import { codexAdapter } from './codex/adapter.js';
import { geminiAdapter } from './gemini/adapter.js';

/**
 * @typedef {import('./types.js').ProviderAdapter} ProviderAdapter
 * @typedef {import('./types.js').SessionProvider} SessionProvider
 */

/** @type {Map<string, ProviderAdapter>} */
const providers = new Map();

// Register built-in providers
providers.set('claude', claudeAdapter);
providers.set('cursor', cursorAdapter);
providers.set('codex', codexAdapter);
providers.set('gemini', geminiAdapter);

/**
 * Get a provider adapter by name.
 * @param {string} name - Provider name (e.g., 'claude', 'cursor', 'codex', 'gemini')
 * @returns {ProviderAdapter | undefined}
 */
export function getProvider(name) {
  return providers.get(name);
}

/**
 * Get all registered provider names.
 * @returns {string[]}
 */
export function getAllProviders() {
  return Array.from(providers.keys());
}
