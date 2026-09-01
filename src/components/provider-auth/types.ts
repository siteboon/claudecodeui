import type { LLMProvider } from '../../types/app';

export type ProviderAuthStatus = {
  /** Whether the CLI binary is installed on this host. */
  installed: boolean;
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error: string | null;
  /**
   * Backend-suggested login command for the terminal login modal. Only
   * providers needing a resolved engine path (zcode) provide it; the modal
   * falls back to its static per-provider command when null.
   */
  loginCommand: string | null;
  loading: boolean;
};

export type ProviderAuthStatusMap = Record<LLMProvider, ProviderAuthStatus>;

export const CLI_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode', 'zcode', 'antigravity'];

export const PROVIDER_AUTH_STATUS_ENDPOINTS: Record<LLMProvider, string> = {
  claude: '/api/providers/claude/auth/status',
  cursor: '/api/providers/cursor/auth/status',
  codex: '/api/providers/codex/auth/status',
  opencode: '/api/providers/opencode/auth/status',
  zcode: '/api/providers/zcode/auth/status',
  antigravity: '/api/providers/antigravity/auth/status',
};

export const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
  claude: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  cursor: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  codex: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  opencode: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  zcode: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
  antigravity: { installed: true, authenticated: false, email: null, method: null, error: null, loginCommand: null, loading },
});
