import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import MemoryPanel from './MemoryPanel';
import type { MemoryEntry } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const memories: MemoryEntry[] = [
  { id: '1', title: 'User role', content: 'Senior engineer', type: 'user', createdAt: '2025-06-01T00:00:00Z' },
  { id: '2', title: 'Project goal', content: 'Ship v2', type: 'project', createdAt: '2025-06-01T00:00:00Z' },
  { id: '3', title: 'Code style', content: 'Prefer functional', type: 'style', createdAt: '2025-06-01T00:00:00Z' },
];

describe('MemoryPanel', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    memories,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<MemoryPanel {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders panel title when open', () => {
    render(<MemoryPanel {...defaultProps} />);
    expect(screen.getByText('memory.title')).toBeDefined();
  });

  it('renders all memory entries', () => {
    render(<MemoryPanel {...defaultProps} />);
    expect(screen.getByText('User role')).toBeDefined();
    expect(screen.getByText('Project goal')).toBeDefined();
    expect(screen.getByText('Code style')).toBeDefined();
  });

  it('shows memory content text', () => {
    render(<MemoryPanel {...defaultProps} />);
    expect(screen.getByText('Senior engineer')).toBeDefined();
  });

  it('shows type badge for each memory', () => {
    const { container } = render(<MemoryPanel {...defaultProps} />);
    const badges = container.querySelectorAll('[data-testid="memory-type-badge"]');
    expect(badges.length).toBe(3);
  });

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<MemoryPanel {...defaultProps} onDelete={onDelete} />);
    const deleteButtons = screen.getAllByLabelText('memory.delete');
    fireEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalledWith('1');
  });

  it('enters edit mode when edit button is clicked', () => {
    render(<MemoryPanel {...defaultProps} />);
    const editButtons = screen.getAllByLabelText('memory.edit');
    fireEvent.click(editButtons[0]);
    const textarea = screen.getByDisplayValue('Senior engineer');
    expect(textarea).toBeDefined();
  });

  it('calls onEdit with new content when save is clicked', () => {
    const onEdit = vi.fn();
    render(<MemoryPanel {...defaultProps} onEdit={onEdit} />);
    const editButtons = screen.getAllByLabelText('memory.edit');
    fireEvent.click(editButtons[0]);
    const textarea = screen.getByDisplayValue('Senior engineer');
    fireEvent.change(textarea, { target: { value: 'Staff engineer' } });
    fireEvent.click(screen.getByText('memory.save'));
    expect(onEdit).toHaveBeenCalledWith('1', 'Staff engineer');
  });

  it('shows empty state when no memories exist', () => {
    render(<MemoryPanel {...defaultProps} memories={[]} />);
    expect(screen.getByText('memory.empty')).toBeDefined();
  });

  it('filters memories by search query', () => {
    render(<MemoryPanel {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('memory.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'engineer' } });
    expect(screen.getByText('User role')).toBeDefined();
    expect(screen.queryByText('Project goal')).toBeNull();
  });
});
