import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { SessionWithProvider } from '../../types/types';

import ConversationItem from './ConversationItem';

function makeSession(overrides: Partial<SessionWithProvider> = {}): SessionWithProvider {
  return {
    id: 'sess-1',
    summary: 'Fix the login bug',
    __provider: 'claude',
    lastActivity: new Date().toISOString(),
    ...overrides,
  } as SessionWithProvider;
}

describe('ConversationItem', () => {
  it('renders session summary as truncated single-line title', () => {
    render(
      <ConversationItem
        session={makeSession()}
        isActive={false}
        onClick={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Fix the login bug')).toBeDefined();
  });

  it('falls back to session id when summary is missing', () => {
    render(
      <ConversationItem
        session={makeSession({ summary: undefined })}
        isActive={false}
        onClick={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('sess-1')).toBeDefined();
  });

  it('applies active styling when isActive is true', () => {
    const { container } = render(
      <ConversationItem
        session={makeSession()}
        isActive={true}
        onClick={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );
    const item = container.querySelector('[data-testid="conversation-item"]');
    expect(item).toBeDefined();
    expect(item!.className).toContain('font-medium');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <ConversationItem
        session={makeSession()}
        isActive={false}
        onClick={onClick}
        onMenuOpen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Fix the login bug'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows 3-dot menu button on hover (via group-hover)', () => {
    const { container } = render(
      <ConversationItem
        session={makeSession()}
        isActive={false}
        onClick={vi.fn()}
        onMenuOpen={vi.fn()}
      />,
    );
    const menuBtn = container.querySelector('[data-testid="conversation-menu-btn"]');
    expect(menuBtn).toBeDefined();
    expect(menuBtn!.className).toContain('opacity-0');
    expect(menuBtn!.className).toContain('group-hover:opacity-100');
  });

  it('calls onMenuOpen with click event when 3-dot button is clicked', () => {
    const onMenuOpen = vi.fn();
    const { container } = render(
      <ConversationItem
        session={makeSession()}
        isActive={false}
        onClick={vi.fn()}
        onMenuOpen={onMenuOpen}
      />,
    );
    const menuBtn = container.querySelector('[data-testid="conversation-menu-btn"]')!;
    fireEvent.click(menuBtn);
    expect(onMenuOpen).toHaveBeenCalledOnce();
  });

  it('does not trigger onClick when 3-dot button is clicked', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ConversationItem
        session={makeSession()}
        isActive={false}
        onClick={onClick}
        onMenuOpen={vi.fn()}
      />,
    );
    const menuBtn = container.querySelector('[data-testid="conversation-menu-btn"]')!;
    fireEvent.click(menuBtn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onContextMenu with right-click', () => {
    const onMenuOpen = vi.fn();
    const { container } = render(
      <ConversationItem
        session={makeSession()}
        isActive={false}
        onClick={vi.fn()}
        onMenuOpen={onMenuOpen}
      />,
    );
    const item = container.querySelector('[data-testid="conversation-item"]')!;
    fireEvent.contextMenu(item);
    expect(onMenuOpen).toHaveBeenCalledOnce();
  });
});
