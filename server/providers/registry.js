/**
 * Provider Registry
 *
 * Centralizes provider adapter and status checker lookup. All code that needs
 * a provider adapter or status checker should go through this registry instead
 * of importing individual modules directly.
 *
 * @module providers/registry
 */

import { claudeAdapter } from './claude/adapter.js';
import { cursorAdapter } from './cursor/adapter.js';
import { codexAdapter } from './codex/adapter.js';
import { geminiAdapter } from './gemini/adapter.js';
import { kiroAdapter } from './kiro/adapter.js';

import * as claudeStatus from './claude/status.js';
import * as cursorStatus from './cursor/status.js';
import * as codexStatus from './codex/status.js';
import * as geminiStatus from './gemini/status.js';

/**
 * @typedef {import('./types.js').ProviderAdapter} ProviderAdapter
 * @typedef {import('./types.js').SessionProvider} SessionProvider
 */

/** @type {Map<string, ProviderAdapter>} */
const providers = new Map();

/** @type {Map<string, { checkInstalled: () => boolean, checkStatus: () => Promise<import('./types.js').ProviderStatus> }>} */
const statusCheckers = new Map();

// Register built-in providers
providers.set('claude', claudeAdapter);
providers.set('cursor', cursorAdapter);
providers.set('codex', codexAdapter);
providers.set('gemini', geminiAdapter);
providers.set('kiro', kiroAdapter);

statusCheckers.set('claude', claudeStatus);
statusCheckers.set('cursor', cursorStatus);
statusCheckers.set('codex', codexStatus);
statusCheckers.set('gemini', geminiStatus);

/**
 * Get a provider adapter by name.
 * @param {string} name - Provider name (e.g., 'claude', 'cursor', 'codex', 'gemini', 'kiro')
 * @returns {ProviderAdapter | undefined}
 */
export function getProvider(name) {
  return providers.get(name);
}

/**
 * Get a provider status checker by name.
 * @param {string} name - Provider name
 * @returns {{ checkInstalled: () => boolean, checkStatus: () => Promise<import('./types.js').ProviderStatus> } | undefined}
 */
export function getStatusChecker(name) {
  return statusCheckers.get(name);
}

/**
 * Get all registered provider names.
 * @returns {string[]}
 */
export function getAllProviders() {
  return Array.from(providers.keys());
}
