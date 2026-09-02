import type { LLMProvider } from '../types/app';

/**
 * Canonical provider → human-readable display name mapping. Provider brand
 * names are never translated, so this single record backs every label site
 * (chat composer labels, sidebar session items, the command modal, shell
 * overlays). When integrating a new LLMProvider, add it here and to
 * `LLMProviderLogo` so the name and avatar stay in sync.
 */
const PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
  zcode: 'ZCode',
  antigravity: 'Antigravity',
};

/**
 * Resolves the display name for a provider value, tolerating missing or
 * legacy values by falling back to Claude (the historical default provider).
 */
export const getProviderDisplayName = (provider?: string | null): string => {
  const key = provider?.trim() as LLMProvider | undefined | null;
  return (key && PROVIDER_DISPLAY_NAMES[key]) || PROVIDER_DISPLAY_NAMES.claude;
};

export { PROVIDER_DISPLAY_NAMES };
