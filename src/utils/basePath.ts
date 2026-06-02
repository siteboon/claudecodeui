/**
 * Shared base path helper for subpath deployment support.
 * When CloudCLI is served from a subpath (e.g. /s/mealstead/),
 * the server injects window.__CLOUDCLI_BASE_PATH__ at runtime.
 */

declare global {
  interface Window {
    __CLOUDCLI_BASE_PATH__?: string;
    __ROUTER_BASENAME__?: string;
  }
}

export const BASE_PATH = window.__CLOUDCLI_BASE_PATH__ || '';

export const assetUrl = (path: string): string => `${BASE_PATH}${path}`;
