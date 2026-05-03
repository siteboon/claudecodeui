import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import HeaderBar from './HeaderBar';

const defaultProps = {
  isMobile: false,
  onMenuClick: vi.fn(),
  onNewChat: vi.fn(),
  onShowSettings: vi.fn(),
  modelName: 'Claude Opus 4',
  onModelSelectorOpen: vi.fn(),
};

describe('HeaderBar', () => {
  it('renders model name in center', () => {
    render(<HeaderBar {...defaultProps} />);
    expect(screen.getByText('Claude Opus 4')).toBeDefined();
  });

  it('renders settings and new chat buttons', () => {
    const { container } = render(<HeaderBar {...defaultProps} />);
    expect(container.querySelector('[data-testid="header-settings-btn"]')).toBeDefined();
    expect(container.querySelector('[data-testid="header-new-chat-btn"]')).toBeDefined();
  });

  it('calls onMenuClick when sidebar toggle is clicked', () => {
    const onMenuClick = vi.fn();
    const { container } = render(<HeaderBar {...defaultProps} onMenuClick={onMenuClick} />);
    const menuBtn = container.querySelector('[data-testid="header-menu-btn"]')!;
    fireEvent.click(menuBtn);
    expect(onMenuClick).toHaveBeenCalledOnce();
  });

  it('calls onModelSelectorOpen when model button is clicked', () => {
    const onModelSelectorOpen = vi.fn();
    render(<HeaderBar {...defaultProps} onModelSelectorOpen={onModelSelectorOpen} />);
    fireEvent.click(screen.getByText('Claude Opus 4'));
    expect(onModelSelectorOpen).toHaveBeenCalledOnce();
  });

  it('calls onNewChat when new chat button is clicked', () => {
    const onNewChat = vi.fn();
    const { container } = render(<HeaderBar {...defaultProps} onNewChat={onNewChat} />);
    fireEvent.click(container.querySelector('[data-testid="header-new-chat-btn"]')!);
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it('calls onShowSettings when settings button is clicked', () => {
    const onShowSettings = vi.fn();
    const { container } = render(<HeaderBar {...defaultProps} onShowSettings={onShowSettings} />);
    fireEvent.click(container.querySelector('[data-testid="header-settings-btn"]')!);
    expect(onShowSettings).toHaveBeenCalledOnce();
  });

  it('has sticky positioning with backdrop blur', () => {
    const { container } = render(<HeaderBar {...defaultProps} />);
    const header = container.querySelector('[data-testid="header-bar"]');
    expect(header).toBeDefined();
    expect(header!.className).toContain('sticky');
    expect(header!.className).toContain('backdrop-blur');
  });
});
