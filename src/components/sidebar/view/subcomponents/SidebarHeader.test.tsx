import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import SidebarHeader from './SidebarHeader';

const defaultProps = {
  isPWA: false,
  isMobile: false,
  isLoading: false,
  projectsCount: 3,
  searchFilter: '',
  onSearchFilterChange: vi.fn(),
  onClearSearchFilter: vi.fn(),
  searchMode: 'conversations' as const,
  onSearchModeChange: vi.fn(),
  onRefresh: vi.fn(),
  isRefreshing: false,
  onCreateProject: vi.fn(),
  onCollapseSidebar: vi.fn(),
  onNewChat: vi.fn(),
  t: ((key: string) => key) as any,
};

describe('SidebarHeader', () => {
  describe('S1: New Chat button', () => {
    it('renders a New Chat button', () => {
      render(<SidebarHeader {...defaultProps} />);
      const btn = screen.getByTestId('new-chat-btn');
      expect(btn).toBeDefined();
    });

    it('New Chat button uses primary color styling', () => {
      render(<SidebarHeader {...defaultProps} />);
      const btn = screen.getByTestId('new-chat-btn');
      expect(btn.className).toContain('bg-primary');
      expect(btn.className).toContain('text-primary-foreground');
    });

    it('New Chat button has rounded-full styling', () => {
      render(<SidebarHeader {...defaultProps} />);
      const btn = screen.getByTestId('new-chat-btn');
      expect(btn.className).toContain('rounded-full');
    });

    it('calls onNewChat when New Chat button is clicked', () => {
      const onNewChat = vi.fn();
      render(<SidebarHeader {...defaultProps} onNewChat={onNewChat} />);
      const btn = screen.getByTestId('new-chat-btn');
      fireEvent.click(btn);
      expect(onNewChat).toHaveBeenCalledOnce();
    });
  });
});
