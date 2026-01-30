/**
 * Provider configuration utility
 *
 * Controls which AI providers are available in the UI.
 * Set VITE_ENABLED_PROVIDERS in .env to customize.
 *
 * @module utils/providers
 * @example
 * // Environment variable examples:
 * // VITE_ENABLED_PROVIDERS=claude           - Only Claude Code
 * // VITE_ENABLED_PROVIDERS=claude,cursor    - Claude and Cursor
 * // VITE_ENABLED_PROVIDERS=claude,cursor,codex  - All providers (default)
 */

/**
 * List of all supported provider identifiers.
 * @constant {string[]}
 */
const ALL_PROVIDERS = ['claude', 'cursor', 'codex'];

/**
 * Retrieves the list of enabled providers from environment variable.
 *
 * Parses the VITE_ENABLED_PROVIDERS environment variable and returns
 * an array of valid provider names. Invalid provider names are filtered out.
 *
 * @function getEnabledProviders
 * @returns {string[]} Array of enabled provider names (lowercase)
 * @example
 * // With VITE_ENABLED_PROVIDERS=claude,cursor
 * getEnabledProviders(); // ['claude', 'cursor']
 *
 * @example
 * // Without VITE_ENABLED_PROVIDERS set
 * getEnabledProviders(); // ['claude', 'cursor', 'codex']
 */
export function getEnabledProviders() {
  const envProviders = import.meta.env.VITE_ENABLED_PROVIDERS;

  if (!envProviders) {
    // Default: all providers enabled
    return ALL_PROVIDERS;
  }

  // Parse comma-separated list and filter valid providers
  const providers = envProviders
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => ALL_PROVIDERS.includes(p));

  // Fallback to claude if no valid providers
  return providers.length > 0 ? providers : ['claude'];
}

/**
 * Checks if a specific provider is enabled.
 *
 * Safely handles null, undefined, and non-string inputs by returning false.
 *
 * @function isProviderEnabled
 * @param {*} provider - Provider name to check (expected: 'claude', 'cursor', 'codex')
 * @returns {boolean} True if provider is enabled, false otherwise
 * @example
 * // With VITE_ENABLED_PROVIDERS=claude
 * isProviderEnabled('claude');  // true
 * isProviderEnabled('cursor');  // false
 * isProviderEnabled(null);      // false
 * isProviderEnabled(undefined); // false
 */
export function isProviderEnabled(provider) {
  // Safely handle null, undefined, or non-string inputs
  if (typeof provider !== 'string' || !provider.trim()) {
    return false;
  }
  return getEnabledProviders().includes(provider.toLowerCase());
}

/**
 * Gets the default provider (first enabled provider).
 *
 * Returns the first provider from the enabled list, falling back to 'claude'
 * if somehow the list is empty (which shouldn't happen with current logic).
 *
 * @function getDefaultProvider
 * @returns {string} The default provider name
 * @example
 * // With VITE_ENABLED_PROVIDERS=cursor,claude
 * getDefaultProvider(); // 'cursor'
 */
export function getDefaultProvider() {
  return getEnabledProviders()[0] || 'claude';
}
