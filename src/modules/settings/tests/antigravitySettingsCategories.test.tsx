import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import '@/modules/i18n';
import AgentsSettingsTab from '@/modules/settings/tabs/agents-settings/AgentsSettingsTab';

// Keep this navigation regression independent of account/network panel effects.
vi.mock('@/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection', () => ({
  default: ({ selectedAgent, selectedCategory }: { selectedAgent: string; selectedCategory: string }) =>
    <div data-testid="active-category">{selectedAgent}:{selectedCategory}</div>,
}));

it('leaves the permissions pane when switching to Antigravity and keeps supported categories', () => {
  const status = { authenticated: false, email: null, method: null, loading: false, error: null };
  const props: ComponentProps<typeof AgentsSettingsTab> = {
    providerAuthStatus: { claude: status, cursor: status, codex: status, opencode: status, antigravity: status },
    onProviderLogin: vi.fn(),
    claudePermissions: { skipPermissions: false, allowedTools: [], disallowedTools: [] },
    onClaudePermissionsChange: vi.fn(),
    cursorPermissions: { skipPermissions: false, allowedCommands: [], disallowedCommands: [] },
    onCursorPermissionsChange: vi.fn(),
    codexPermissionMode: 'default', onCodexPermissionModeChange: vi.fn(), projects: [],
  };
  render(<AgentsSettingsTab {...props} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Permissions' }));
  expect(screen.getByTestId('active-category').textContent).toBe('claude:permissions');
  fireEvent.click(screen.getByRole('button', { name: /Antigravity/ }));
  expect(screen.queryByRole('tab', { name: 'Permissions' })).toBeNull();
  expect(screen.getByTestId('active-category').textContent).toBe('antigravity:account');
  fireEvent.click(screen.getByRole('tab', { name: 'Skills' }));
  expect(screen.getByTestId('active-category').textContent).toBe('antigravity:skills');
  fireEvent.click(screen.getByRole('button', { name: /Claude/ }));
  expect(screen.getByRole('tab', { name: 'Permissions' })).toBeTruthy();
});
