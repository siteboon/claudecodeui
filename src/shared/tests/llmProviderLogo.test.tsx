import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { test } from 'vitest';

import { LLMProviderLogo } from '@/shared/ui/LLMProviderLogo';

/**
 * Session rows pass their persisted provider straight through to the shared
 * logo. Keep every supported provider explicit so a new provider cannot fall
 * through to Claude's otherwise intentional legacy fallback.
 */
test('renders the Antigravity mark for Antigravity sessions', () => {
  const { getByRole } = render(<LLMProviderLogo provider="antigravity" />);

  assert.equal(getByRole('img').getAttribute('aria-label'), 'Antigravity');
});
