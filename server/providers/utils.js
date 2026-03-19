/**
 * Shared provider utilities.
 *
 * @module providers/utils
 */

/**
 * Prefixes that indicate internal/system content which should be hidden from the UI.
 * @type {readonly string[]}
 */
export const INTERNAL_CONTENT_PREFIXES = Object.freeze([
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command-stdout>',
  '<system-reminder>',
  'Caveat:',
  'This session is being continued from a previous',
  '[Request interrupted',
]);

/**
 * Check if user text content is internal/system that should be skipped.
 * @param {string} content
 * @returns {boolean}
 */
export function isInternalContent(content) {
  return INTERNAL_CONTENT_PREFIXES.some(prefix => content.startsWith(prefix));
}
