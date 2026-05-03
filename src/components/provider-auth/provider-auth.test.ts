import { describe, test, expect } from 'vitest';

import {
  CLI_PROVIDERS,
  PROVIDER_AUTH_STATUS_ENDPOINTS,
  createInitialProviderAuthStatusMap,
} from './types';

describe('Provider auth types include openclaude', () => {
  test('CLI_PROVIDERS includes openclaude', () => {
    expect(CLI_PROVIDERS).toContain('openclaude');
  });

  test('PROVIDER_AUTH_STATUS_ENDPOINTS has openclaude key', () => {
    expect(PROVIDER_AUTH_STATUS_ENDPOINTS).toHaveProperty('openclaude');
    expect(PROVIDER_AUTH_STATUS_ENDPOINTS.openclaude).toBe(
      '/api/providers/openclaude/auth/status',
    );
  });

  test('createInitialProviderAuthStatusMap includes openclaude', () => {
    const map = createInitialProviderAuthStatusMap();
    expect(map).toHaveProperty('openclaude');
    expect(map.openclaude.loading).toBe(true);
    expect(map.openclaude.authenticated).toBe(false);
  });
});
