import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpProvider, McpScope } from '@/shared/types';

/**
 * The MCP settings list is informational until the user asks for a health
 * check, so these tests drive the real hook through the real component and
 * assert on `data-mcp-status`, which is the one signal that does not depend on
 * an initialised i18n instance.
 */

type StatusEntry = { name: string; state: string; detail?: string };

const mcpServersMock = vi.fn();
const mcpServerStatusesMock = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      mcpServers: (...args: unknown[]) => mcpServersMock(...args),
      mcpServerStatuses: (...args: unknown[]) => mcpServerStatusesMock(...args),
    },
  },
}));

const { default: McpServers } = await import('@/modules/mcp/McpServers');

const jsonResponse = (data: unknown) => ({
  ok: true,
  json: async () => ({ success: true, data }),
});

const USER_SERVERS = [
  { provider: 'claude', name: 'internal-http', scope: 'user', transport: 'http', url: 'https://mcp.example/mcp' },
  { provider: 'claude', name: 'local-tools', scope: 'user', transport: 'stdio', command: 'node', args: ['server.js'] },
  { provider: 'claude', name: 'never-probed', scope: 'user', transport: 'stdio', command: 'node', args: ['other.js'] },
];

const setupApi = (statuses: StatusEntry[], options: { supported?: boolean; error?: string } = {}) => {
  mcpServersMock.mockImplementation(async (_provider: McpProvider, query: { scope: McpScope }) =>
    jsonResponse({ provider: 'claude', scope: query.scope, servers: query.scope === 'user' ? USER_SERVERS : [] }));
  mcpServerStatusesMock.mockImplementation(async () =>
    jsonResponse({
      provider: 'claude',
      supported: options.supported ?? true,
      statuses,
      ...(options.error ? { error: options.error } : {}),
    }));
};

const renderServers = async () => {
  render(<McpServers selectedProvider="claude" currentProjects={[]} />);
  await waitFor(() => expect(screen.getByText('internal-http')).toBeTruthy());
};

const statusFor = (serverName: string) => {
  const card = screen.getByText(serverName).closest('div.rounded-lg');
  return card?.querySelector('[data-mcp-status]')?.getAttribute('data-mcp-status') ?? null;
};

describe('MCP server connection status', () => {
  beforeEach(() => {
    mcpServersMock.mockReset();
    mcpServerStatusesMock.mockReset();
  });

  it('shows no status until the user asks for a check', async () => {
    setupApi([]);
    await renderServers();

    expect(document.querySelectorAll('[data-mcp-status]').length).toBe(0);
    expect(mcpServerStatusesMock).not.toHaveBeenCalled();
  });

  it('labels each server with the state the provider reported', async () => {
    setupApi([
      { name: 'internal-http', state: 'failed', detail: 'Failed to connect - HTTP 401' },
      { name: 'local-tools', state: 'connected' },
    ]);
    await renderServers();

    fireEvent.click(screen.getByTitle('mcpServers.connection.checkHint'));

    await waitFor(() => expect(statusFor('internal-http')).toBe('failed'));
    expect(statusFor('local-tools')).toBe('connected');
    // A server the health check never mentioned must read as unknown, not as a
    // failure, and the provider's own failure text is shown verbatim.
    expect(statusFor('never-probed')).toBe('unknown');
    expect(screen.getByText('Failed to connect - HTTP 401')).toBeTruthy();
  });

  it('marks every server unknown when the provider reports no health check', async () => {
    setupApi([], { supported: false });
    await renderServers();

    fireEvent.click(screen.getByTitle('mcpServers.connection.checkHint'));

    await waitFor(() => expect(statusFor('internal-http')).toBe('unknown'));
    expect(statusFor('local-tools')).toBe('unknown');
    expect(mcpServerStatusesMock).toHaveBeenCalledTimes(1);
  });
});
