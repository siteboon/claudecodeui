import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import { ContextSourcesSection } from '@/modules/chat/panel/ContextSourcesSection';
import type { McpScope, ProviderMcpServer, ProviderSkill } from '@/shared/types';

// Keys stand in for translations; the panel-level test covers the catalog.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const skill = (name: string, scope: ProviderSkill['scope'] = 'user'): ProviderSkill => ({
  provider: 'claude',
  name,
  description: `${name} desc`,
  command: `/${name}`,
  scope,
  sourcePath: `skills/${name}.md`,
});

const server = (name: string, scope: McpScope = 'user'): ProviderMcpServer => ({
  provider: 'claude',
  name,
  scope,
  transport: 'stdio',
  command: `${name}-bin`,
});

test('each group counts and lists its rows with the scope tag', () => {
  render(
    <ContextSourcesSection
      skills={[skill('commit'), skill('review', 'project')]}
      skillsLoading={false}
      mcpServers={[server('github')]}
      mcpLoading={false}
    />,
  );

  // Group headers carry the counts; loading would replace them with "…".
  assert.ok(screen.getByText('sessionInfoPanel.sourcesSkills'));
  assert.ok(screen.getByText('sessionInfoPanel.sourcesMcp'));
  assert.ok(screen.getByText('2'));
  assert.ok(screen.getByText('1'));

  assert.ok(screen.getByText('commit'));
  assert.ok(screen.getByText('review'));
  assert.ok(screen.getByText('github'));
  // The tag uppercases through CSS, so the DOM text is the raw scope value.
  assert.ok(screen.getByText('project'));
});

test('a loading group shows the ellipsis instead of the count', () => {
  render(
    <ContextSourcesSection
      skills={[]}
      skillsLoading={true}
      mcpServers={[]}
      mcpLoading={false}
    />,
  );

  assert.ok(screen.getByText('…'));
  assert.ok(screen.getByText('0'));
});
