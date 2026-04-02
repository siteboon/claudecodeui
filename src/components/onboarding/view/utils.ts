import { IS_PLATFORM } from '../../../constants/config';
import type { CliProvider, ProviderStatusMap } from './types';

export const cliProviders: CliProvider[] = ['claude', 'cursor', 'codex', 'gemini'];

export const gitEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const selectedProject = {
  name: 'default',
  displayName: 'default',
  fullPath: IS_PLATFORM ? '/workspace' : '',
  path: IS_PLATFORM ? '/workspace' : '',
};

export const createInitialProviderStatuses = (): ProviderStatusMap => ({
  claude: { authenticated: false, email: null, loading: true, error: null },
  cursor: { authenticated: false, email: null, loading: true, error: null },
  codex: { authenticated: false, email: null, loading: true, error: null },
  gemini: { authenticated: false, email: null, loading: true, error: null },
});

export const readErrorMessageFromResponse = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
};
