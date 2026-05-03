import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ConversationContextMenu from './ConversationContextMenu';

const defaultProps = {
  position: { x: 100, y: 200 },
  onClose: vi.fn(),
  onRename: vi.fn(),
  onPin: vi.fn(),
  onDelete: vi.fn(),
};

describe('ConversationContextMenu', () => {
  it('renders menu items: Rename, Pin, Delete', () => {
    render(<ConversationContextMenu {...defaultProps} />);
    expect(screen.getByText('Rename')).toBeDefined();
    expect(screen.getByText('Pin to top')).toBeDefined();
    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('positions at the given x,y coordinates', () => {
    const { container } = render(<ConversationContextMenu {...defaultProps} />);
    const menu = container.querySelector('[data-testid="context-menu"]') as HTMLElement;
    expect(menu).toBeDefined();
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('200px');
  });

  it('calls onRename and onClose when Rename is clicked', () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    render(<ConversationContextMenu {...defaultProps} onRename={onRename} onClose={onClose} />);
    fireEvent.click(screen.getByText('Rename'));
    expect(onRename).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onPin and onClose when Pin is clicked', () => {
    const onPin = vi.fn();
    const onClose = vi.fn();
    render(<ConversationContextMenu {...defaultProps} onPin={onPin} onClose={onClose} />);
    fireEvent.click(screen.getByText('Pin to top'));
    expect(onPin).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onDelete and onClose when Delete is clicked', () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    render(<ConversationContextMenu {...defaultProps} onDelete={onDelete} onClose={onClose} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows delete item with destructive styling', () => {
    const { container } = render(<ConversationContextMenu {...defaultProps} />);
    const deleteItem = container.querySelector('[data-testid="context-menu-delete"]');
    expect(deleteItem).toBeDefined();
    expect(deleteItem!.className).toContain('text-destructive');
  });
});
