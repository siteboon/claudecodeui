import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

import '@/modules/i18n';
import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';
import type { ClaudeSettingsPermissionSource } from '@/shared/types';

// Issue #109: the Claude CLI applies the permission rules in its own settings
// files on top of the lists in this panel, so a tool could run (or be refused)
// with nothing here explaining why. The panel now lists those rules read-only.

const claudeSettingsPermissions = vi.fn<() => Promise<Response>>();

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api')>();
  return {
    ...actual,
    api: { ...actual.api, providers: { ...actual.api.providers, claudeSettingsPermissions: () => claudeSettingsPermissions() } },
  };
});

const source = (overrides: Partial<ClaudeSettingsPermissionSource>): ClaudeSettingsPermissionSource => ({
  scope: 'user',
  path: '/home/me/.claude/settings.json',
  status: 'ok',
  allow: [],
  deny: [],
  ask: [],
  ...overrides,
});

const respondWith = (sources: ClaudeSettingsPermissionSource[]) => {
  claudeSettingsPermissions.mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: { sources } }), { status: 200 }),
  );
};

const renderClaudePermissions = () => render(
  <PermissionsContent
    agent="claude"
    skipPermissions={false}
    onSkipPermissionsChange={() => {}}
    allowedTools={['Bash(make:*)']}
    onAllowedToolsChange={() => {}}
    disallowedTools={[]}
    onDisallowedToolsChange={() => {}}
  />,
);

describe('Claude permissions: rules from the Claude settings files', () => {
  beforeEach(() => {
    claudeSettingsPermissions.mockReset();
  });

  it('lists the user file rules grouped by allow, ask and deny, with the file path and the read-only note', async () => {
    respondWith([
      source({ allow: ['Bash(npm run test:*)', 'WebFetch'], ask: ['Bash(git push:*)'], deny: ['Bash(rm:*)'] }),
      source({ scope: 'managed', path: '/etc/claude-code/managed-settings.json', status: 'missing' }),
    ]);
    renderClaudePermissions();

    const card = await screen.findByTestId('claude-settings-file-user');
    expect(within(card).getByText('Your settings')).toBeTruthy();
    expect(within(card).getByText('/home/me/.claude/settings.json')).toBeTruthy();
    expect(within(card).getByText('Allow')).toBeTruthy();
    expect(within(card).getByText('Bash(npm run test:*)')).toBeTruthy();
    expect(within(card).getByText('WebFetch')).toBeTruthy();
    expect(within(card).getByText('Ask')).toBeTruthy();
    expect(within(card).getByText('Bash(git push:*)')).toBeTruthy();
    expect(within(card).getByText('Deny')).toBeTruthy();
    expect(within(card).getByText('Bash(rm:*)')).toBeTruthy();
    // Read-only: no remove buttons inside the file card.
    expect(within(card).queryByRole('button')).toBeNull();

    const section = screen.getByTestId('claude-settings-file-rules');
    expect(section.textContent).toContain('Rules from Claude settings files');
    expect(section.textContent).toContain('on top of the lists above');
    expect(section.textContent).toContain('edit them in the files');
    expect(section.textContent).toContain('.claude/settings.local.json also apply to chats in that project');
    // A managed file that does not exist is the normal case and stays hidden.
    expect(screen.queryByTestId('claude-settings-file-managed')).toBeNull();
    // The UI's own list is still there and unchanged.
    expect(screen.getByText('Bash(make:*)')).toBeTruthy();
  });

  it('shows the managed settings file when one exists', async () => {
    respondWith([
      source({ status: 'missing' }),
      source({ scope: 'managed', path: '/etc/claude-code/managed-settings.json', deny: ['WebSearch'] }),
    ]);
    renderClaudePermissions();

    const managed = await screen.findByTestId('claude-settings-file-managed');
    expect(within(managed).getByText('Managed settings (administrator)')).toBeTruthy();
    expect(within(managed).getByText('WebSearch')).toBeTruthy();
    expect(within(screen.getByTestId('claude-settings-file-user')).getByText('File not found, so it adds no rules.')).toBeTruthy();
  });

  it('says a file could not be read instead of showing rules when its JSON is invalid', async () => {
    respondWith([source({ status: 'invalid' })]);
    renderClaudePermissions();

    const card = await screen.findByTestId('claude-settings-file-user');
    expect(card.textContent).toContain('This file could not be read. Check that it is valid JSON.');
    expect(within(card).queryByText('Allow')).toBeNull();
  });

  it('says so when a readable file has no permission rules', async () => {
    respondWith([source({})]);
    renderClaudePermissions();

    const card = await screen.findByTestId('claude-settings-file-user');
    expect(card.textContent).toContain('No permission rules in this file.');
  });

  it('keeps the panel usable and shows a short hint when the rules cannot be loaded', async () => {
    claudeSettingsPermissions.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderClaudePermissions();

    expect(await screen.findByText('Could not load the rules from the Claude settings files.')).toBeTruthy();
    expect(screen.queryByTestId('claude-settings-file-user')).toBeNull();
    expect(screen.getByText('Allowed Tools')).toBeTruthy();
  });
});
