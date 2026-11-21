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

// Only the endpoint is stubbed; `readApiJson` stays real so the panel parses
// the same envelope the server sends.
vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { providers: { claudeSettingsPermissions: () => claudeSettingsPermissions() } },
}));

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

// The label and the rules of one Allow/Ask/Deny group, so a rule shown under
// the wrong label (a deny rule presented as allowed) fails the test.
const ruleGroup = (scope: ClaudeSettingsPermissionSource['scope'], key: 'allow' | 'ask' | 'deny') => {
  const group = screen.getByTestId(`claude-settings-file-${scope}-${key}`);
  return {
    label: group.firstElementChild?.textContent,
    rules: within(group).getAllByRole('listitem').map((item) => item.textContent),
  };
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
    // Until the server answers, the panel says it is loading rather than "no rules".
    expect(screen.getByText('Loading rules…')).toBeTruthy();

    const card = await screen.findByTestId('claude-settings-file-user');
    expect(screen.queryByText('Loading rules…')).toBeNull();
    expect(within(card).getByText('Your settings')).toBeTruthy();
    expect(within(card).getByText('/home/me/.claude/settings.json')).toBeTruthy();
    expect(ruleGroup('user', 'allow')).toEqual({ label: 'Allow', rules: ['Bash(npm run test:*)', 'WebFetch'] });
    expect(ruleGroup('user', 'ask')).toEqual({ label: 'Ask', rules: ['Bash(git push:*)'] });
    expect(ruleGroup('user', 'deny')).toEqual({ label: 'Deny', rules: ['Bash(rm:*)'] });
    // Read-only: no remove buttons inside the file card.
    expect(within(card).queryByRole('button')).toBeNull();

    const section = screen.getByTestId('claude-settings-file-rules');
    expect(section.textContent).toContain('Rules from Claude settings files');
    expect(section.textContent).toContain('on top of the lists above');
    expect(section.textContent).toContain('an ask rule does not prompt for a tool that Allowed Tools already allows');
    expect(section.textContent).toContain('edit them in the files');
    expect(section.textContent).toContain('.claude/settings.local.json also apply to chats in that project');
    // The CLI drops a project's shared allow rules until the folder is trusted.
    expect(section.textContent).toContain('ignores allow rules in .claude/settings.json until the folder is trusted');
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
    expect(ruleGroup('managed', 'deny')).toEqual({ label: 'Deny', rules: ['WebSearch'] });
    expect(within(managed).queryByText('Allow')).toBeNull();
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

  it('shows the load hint when the server answers with an error envelope', async () => {
    claudeSettingsPermissions.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: { message: 'boom' } }), { status: 500 }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderClaudePermissions();

    expect(await screen.findByText('Could not load the rules from the Claude settings files.')).toBeTruthy();
    expect(screen.queryByTestId('claude-settings-file-user')).toBeNull();
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
