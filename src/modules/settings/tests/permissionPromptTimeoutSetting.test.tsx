import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import AgentCategoryContentSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection';
import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';
import type { AgentContextByProvider, ClaudePermissionsState } from '@/shared/types';

// Issue #607: Claude permission prompts wait for the user by default, and
// Settings > Agents > Claude > Permissions can turn a timeout on.

const renderClaudePermissions = (
  permissionPromptTimeoutMs: number,
  onPermissionPromptTimeoutMsChange: (value: number) => void = () => {},
) => render(
  <PermissionsContent
    agent="claude"
    skipPermissions={false}
    onSkipPermissionsChange={() => {}}
    permissionPromptTimeoutMs={permissionPromptTimeoutMs}
    onPermissionPromptTimeoutMsChange={onPermissionPromptTimeoutMsChange}
    allowedTools={[]}
    onAllowedToolsChange={() => {}}
    disallowedTools={[]}
    onDisallowedToolsChange={() => {}}
  />,
);

const timeoutSelect = () => screen.getByRole('combobox', { name: 'Permission prompt timeout' }) as HTMLSelectElement;

const selectedLabel = (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent;

describe('Claude permission prompt timeout setting', () => {
  it('defaults to waiting for the user and offers the preset timeouts', () => {
    renderClaudePermissions(0);

    const select = timeoutSelect();
    expect(select.value).toBe('0');
    expect(selectedLabel(select)).toBe('Never — wait for my answer');
    expect(Array.from(select.options).map((option) => [option.value, option.textContent])).toEqual([
      ['0', 'Never — wait for my answer'],
      ['60000', '1 minute'],
      ['300000', '5 minutes'],
      ['900000', '15 minutes'],
      ['1800000', '30 minutes'],
      ['3600000', '1 hour'],
    ]);
    expect(select.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent)
      .toContain('Claude Code itself waits indefinitely');
  });

  it('shows the stored timeout', () => {
    renderClaudePermissions(15 * 60_000);

    expect(timeoutSelect().value).toBe('900000');
    expect(selectedLabel(timeoutSelect())).toBe('15 minutes');
  });

  it('reports the chosen timeout in milliseconds', () => {
    const onChange = vi.fn();
    renderClaudePermissions(0, onChange);

    fireEvent.change(timeoutSelect(), { target: { value: '300000' } });
    expect(onChange).toHaveBeenLastCalledWith(300_000);

    fireEvent.change(timeoutSelect(), { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('keeps a stored timeout that is not a preset instead of showing a wrong one', () => {
    renderClaudePermissions(90_000);

    const select = timeoutSelect();
    expect(select.value).toBe('90000');
    expect(selectedLabel(select)).toBe('Custom (90 seconds)');
    expect(select.options).toHaveLength(7);
  });

  it('is placed between the skip-permissions switch and the allowed tools', () => {
    renderClaudePermissions(0);

    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings.slice(0, 3)).toEqual(['Permission Settings', 'Permission prompt timeout', 'Allowed Tools']);
  });

  it('saves the timeout alongside the other Claude permissions', () => {
    const claudePermissions: ClaudePermissionsState = {
      allowedTools: ['Read'],
      disallowedTools: ['Bash(rm:*)'],
      skipPermissions: false,
      permissionPromptTimeoutMs: 0,
    };
    const onClaudePermissionsChange = vi.fn();

    render(
      <AgentCategoryContentSection
        selectedAgent="claude"
        selectedCategory="permissions"
        agentContextById={{} as AgentContextByProvider}
        claudePermissions={claudePermissions}
        onClaudePermissionsChange={onClaudePermissionsChange}
        cursorPermissions={{ allowedCommands: [], disallowedCommands: [], skipPermissions: false }}
        onCursorPermissionsChange={() => {}}
        codexPermissionMode="default"
        onCodexPermissionModeChange={() => {}}
        projects={[]}
      />,
    );

    fireEvent.change(timeoutSelect(), { target: { value: '3600000' } });

    expect(onClaudePermissionsChange).toHaveBeenCalledWith({ ...claudePermissions, permissionPromptTimeoutMs: 3_600_000 });
  });
});
