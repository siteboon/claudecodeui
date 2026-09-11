import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import { McpServersSection } from '@/modules/chat/panel/McpServersSection';
import { flattenMcpServers } from '@/modules/chat/hooks/useSessionMcpServers';
import type { McpScope, ProviderMcpServer } from '@/shared/types';

// Section body has no translated strings it asserts on; t() returning the key
// keeps the mock trivial and the role-based queries locale-independent.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const server = (name: string, scope: McpScope = 'user'): ProviderMcpServer => ({
  provider: 'claude',
  name,
  scope,
  transport: 'stdio',
  command: `${name}-bin`,
});

test('flattenMcpServers dedupes by name across scopes, first scope wins', () => {
  const flat = flattenMcpServers({
    data: {
      scopes: {
        project: [server('shared', 'project')],
        user: [server('shared', 'user'), server('solo', 'user')],
      } as Partial<Record<McpScope, ProviderMcpServer[]>>,
    },
  });

  assert.deepEqual(flat.map((s) => [s.name, s.scope]), [
    ['shared', 'project'],
    ['solo', 'user'],
  ]);
});

test('flattenMcpServers reads the flat servers shape and trims names', () => {
  const flat = flattenMcpServers({
    data: { servers: [server('  spaced  ') as never] },
  });
  assert.deepEqual(flat.map((s) => s.name), ['spaced']);
});

test('flattenMcpServers tolerates an empty or missing payload', () => {
  assert.deepEqual(flattenMcpServers({}), []);
  assert.deepEqual(flattenMcpServers({ data: {} }), []);
});

const renderSection = (overrides: Partial<Parameters<typeof McpServersSection>[0]> = {}) => {
  const toggles: string[] = [];
  render(
    <McpServersSection
      servers={[server('github'), server('fetch')]}
      loading={false}
      disabledSet={new Set(['fetch'])}
      pendingNames={new Set<string>()}
      onToggle={async (name) => { toggles.push(name); return true; }}
      {...overrides}
    />,
  );
  return { toggles };
};

test('a disabled server reads as an off switch and an enabled one as on', () => {
  renderSection();
  // Servers are sorted, so switches[0] is github (on) and switches[1] fetch (off).
  const ordered = screen.getAllByRole('switch').map((el) => el.getAttribute('aria-checked'));
  assert.deepEqual(ordered, ['true', 'false']);
});

test('clicking a switch asks the parent to toggle that name', () => {
  const { toggles } = renderSection();
  fireEvent.click(screen.getAllByRole('switch')[0]);
  assert.deepEqual(toggles, ['github']);
});

test('a pending switch is disabled so it cannot be flipped twice', () => {
  renderSection({ pendingNames: new Set(['github']) });
  const first = screen.getAllByRole('switch')[0];
  assert.equal(first.hasAttribute('disabled'), true);
});

test('a loading empty list shows the loading line, not the empty one', () => {
  renderSection({ servers: [], loading: true });
  assert.ok(screen.getByText('sessionInfoPanel.mcpLoading'));
});
