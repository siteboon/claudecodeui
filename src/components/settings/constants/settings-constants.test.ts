import { describe, test, expect } from 'vitest';

import { AGENT_PROVIDERS, SETTINGS_MAIN_TABS } from './constants';

describe('Settings constants include openclaude', () => {
  test('AGENT_PROVIDERS includes openclaude', () => {
    expect(AGENT_PROVIDERS).toContain('openclaude');
  });
});

describe('SETTINGS_MAIN_TABS includes dashboard', () => {
  test('dashboard tab is present and searchable via CommandPalette', () => {
    const dashboardTab = SETTINGS_MAIN_TABS.find((t) => t.id === 'dashboard');
    expect(dashboardTab).toBeDefined();
    expect(dashboardTab!.label).toBe('Dashboard');
    expect(dashboardTab!.keywords).toContain('dashboard');
  });
});
