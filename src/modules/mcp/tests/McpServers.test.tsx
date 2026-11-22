import { fireEvent, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import '@/modules/i18n';
import McpServers from '@/modules/mcp/McpServers';
import { api } from '@/shared/api';

afterEach(() => vi.restoreAllMocks());

test('Antigravity lists native servers and keeps only the global add action', async () => {
  vi.spyOn(api.providers, 'mcpServers').mockResolvedValue(new Response(JSON.stringify({
    success: true,
    data: {
      provider: 'antigravity',
      scope: 'user',
      servers: [{ name: 'native-tools', transport: 'stdio', command: 'node' }],
    },
  })));

  const view = render(<McpServers selectedProvider="antigravity" currentProjects={[]} />);
  expect(await view.findByText('native-tools')).toBeTruthy();
  expect(view.getByText(/Use \/mcp in Antigravity/)).toBeTruthy();
  expect(view.queryByTitle('Edit server')).toBeNull();
  expect(view.queryByTitle('Delete server')).toBeNull();

  fireEvent.click(view.getByRole('button', { name: 'Add MCP Server' }));
  expect(view.getByText('Add Global MCP Server')).toBeTruthy();
  expect(view.queryByText('Add Antigravity MCP Server')).toBeNull();
});
