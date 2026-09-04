import type { LLMProvider, ProviderAuthStatusMap } from '@/shared/types';

export type { ProviderAuthStatus, ProviderAuthStatusMap } from '@/shared/types';

export const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
  claude: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  cursor: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  codex: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  opencode: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  zcode: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  antigravity: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
});
