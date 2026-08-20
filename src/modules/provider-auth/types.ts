import type { LLMProvider, ProviderAuthStatusMap } from '@/shared/types';



export const CLI_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

export const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
  claude: { authenticated: false, email: null, method: null, error: null, loading },
  cursor: { authenticated: false, email: null, method: null, error: null, loading },
  codex: { authenticated: false, email: null, method: null, error: null, loading },
  opencode: { authenticated: false, email: null, method: null, error: null, loading },
});
