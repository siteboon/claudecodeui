import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { SessionWithProvider } from '../../types/types';

import ConversationGroup from './ConversationGroup';

function makeSession(id: string, summary: string): SessionWithProvider {
  return {
    id,
    summary,
    __provider: 'claude',
    lastActivity: new Date().toISOString(),
  } as SessionWithProvider;
}

describe('ConversationGroup', () => {
  it('renders group label as a heading', () => {
    render(
      <ConversationGroup
        label="Today"
        sessions={[makeSession('s1', 'First chat')]}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Today')).toBeDefined();
  });

  it('renders one ConversationItem per session', () => {
    const sessions = [
      makeSession('s1', 'First chat'),
      makeSession('s2', 'Second chat'),
      makeSession('s3', 'Third chat'),
    ];
    render(
      <ConversationGroup
        label="Yesterday"
        sessions={sessions}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('First chat')).toBeDefined();
    expect(screen.getByText('Second chat')).toBeDefined();
    expect(screen.getByText('Third chat')).toBeDefined();
  });

  it('marks the active session via selectedSessionId', () => {
    const { container } = render(
      <ConversationGroup
        label="Today"
        sessions={[makeSession('s1', 'Active one'), makeSession('s2', 'Other')]}
        selectedSessionId="s1"
        onSessionClick={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );
    const items = container.querySelectorAll('[data-testid="conversation-item"]');
    expect(items[0].className).toContain('font-medium');
    expect(items[1].className).not.toContain('font-medium');
  });

  it('label has uppercase tracking styling', () => {
    const { container } = render(
      <ConversationGroup
        label="Previous 7 Days"
        sessions={[makeSession('s1', 'Chat')]}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );
    const label = container.querySelector('[data-testid="conversation-group-label"]');
    expect(label).toBeDefined();
    expect(label!.className).toContain('uppercase');
    expect(label!.className).toContain('tracking-wider');
  });
});
