/**
 * Cursor provider barrel.
 * Assembles the ProviderAdapter from adapter + sessions.
 */
import { normalizeMessage } from './adapter.js';
import { fetchHistory, normalizeCursorBlobs } from './sessions.js';

export const cursorAdapter = { normalizeMessage, fetchHistory, normalizeCursorBlobs };
