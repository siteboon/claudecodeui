import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import CommandResultModal from '@/modules/chat/modals/CommandResultModal';
import type { CommandModalPayload, McpCommandData, ProviderModelActions } from '@/shared/types';

/**
 * `/mcp` is the chat-side answer to "is this MCP server connected or still
 * waiting to be authenticated?", so these tests assert on `data-mcp-status`,
 * the one marker that does not depend on an initialised i18n instance.
 */

const noopActions = {
  createModel: async () => undefined,
  updateModel: async () => undefined,
  deleteModel: async () => undefined,
} as unknown as ProviderModelActions;

const renderMcpModal = (data: McpCommandData) =>
  render(
    <CommandResultModal
      payload={{ kind: 'mcp', data } as CommandModalPayload}
      onClose={() => undefined}
      providerModelCatalog={{}}
      providerModelActions={noopActions}
      activeProvider="claude"
      activeProviderModel="sonnet"
      currentSessionId={null}
      onSelectProviderModel={async () => ({ scope: 'default' as const, model: 'sonnet' })}
    />,
  );

const statusFor = (serverName: string) => {
  const row = screen.getByText(serverName).closest('div.rounded-2xl');
  return row?.querySelector('[data-mcp-status]')?.getAttribute('data-mcp-status') ?? null;
};

describe('the /mcp command modal', () => {
  it('lists each server with its transport, scope, target and reported status', () => {
    renderMcpModal({
      provider: 'claude',
      providerLabel: 'Claude',
      statusSupported: true,
      servers: [
        {
          name: 'internal-http',
          scope: 'user',
          transport: 'http',
          target: 'https://mcp.example/mcp',
          status: 'failed',
          statusDetail: 'Failed to connect - HTTP 401',
        },
        { name: 'repo-tools', scope: 'project', transport: 'stdio', target: 'node server.js', status: 'connected' },
        { name: 'unapproved', scope: 'project', transport: 'http', target: 'https://mcp.example/two', status: 'pending' },
      ],
    });

    expect(statusFor('internal-http')).toBe('failed');
    expect(statusFor('repo-tools')).toBe('connected');
    expect(statusFor('unapproved')).toBe('pending');
    expect(screen.getByText('https://mcp.example/mcp')).toBeTruthy();
    expect(screen.getByText('node server.js')).toBeTruthy();
    expect(screen.getByText('Failed to connect - HTTP 401')).toBeTruthy();
  });

  it('falls back to unknown rather than a failure when no status was reported', () => {
    renderMcpModal({
      provider: 'codex',
      providerLabel: 'Codex',
      statusSupported: false,
      servers: [{ name: 'codex-tools', scope: 'user', transport: 'stdio', target: 'node codex.js' }],
    });

    expect(statusFor('codex-tools')).toBe('unknown');
  });

  it('renders an empty state instead of a server list when nothing is configured', () => {
    renderMcpModal({ provider: 'claude', providerLabel: 'Claude', statusSupported: true, servers: [] });

    expect(document.querySelectorAll('[data-mcp-status]').length).toBe(0);
  });
});
