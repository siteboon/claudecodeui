import { describe, test, expect } from 'vitest';

import { AGENT_PROVIDERS } from './constants';

describe('Settings constants include openclaude', () => {
  test('AGENT_PROVIDERS includes openclaude', () => {
    expect(AGENT_PROVIDERS).toContain('openclaude');
  });
});
