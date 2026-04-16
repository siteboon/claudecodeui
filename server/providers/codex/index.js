/**
 * Codex provider barrel.
 * Assembles the ProviderAdapter from adapter + sessions.
 */
import { normalizeMessage } from './adapter.js';
import { fetchHistory } from './sessions.js';

export const codexAdapter = { normalizeMessage, fetchHistory };
