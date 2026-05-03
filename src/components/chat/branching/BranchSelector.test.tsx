import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import BranchSelector from './BranchSelector';
import type { ConversationBranch } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const branches: ConversationBranch[] = [
  { id: 'main', name: 'Main', parentBranchId: null, branchPointMessageIndex: 0, createdAt: '2025-06-01T00:00:00Z' },
  { id: 'b1', name: 'Alternative approach', parentBranchId: 'main', branchPointMessageIndex: 3, createdAt: '2025-06-01T01:00:00Z' },
  { id: 'b2', name: 'Refactor version', parentBranchId: 'main', branchPointMessageIndex: 5, createdAt: '2025-06-01T02:00:00Z' },
];

describe('BranchSelector', () => {
  const defaultProps = {
    branches,
    activeBranchId: 'main',
    onSwitchBranch: vi.fn(),
    onCreateBranch: vi.fn(),
    onRenameBranch: vi.fn(),
    onDeleteBranch: vi.fn(),
  };

  it('renders the active branch name', () => {
    render(<BranchSelector {...defaultProps} />);
    expect(screen.getByText('Main')).toBeDefined();
  });

  it('shows branch count indicator', () => {
    render(<BranchSelector {...defaultProps} />);
    expect(screen.getByTestId('branch-count')).toBeDefined();
    expect(screen.getByTestId('branch-count').textContent).toBe('3');
  });

  it('opens branch list when clicked', () => {
    render(<BranchSelector {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /branch/i }));
    expect(screen.getByText('Alternative approach')).toBeDefined();
    expect(screen.getByText('Refactor version')).toBeDefined();
  });

  it('calls onSwitchBranch when a branch is selected', () => {
    const onSwitch = vi.fn();
    render(<BranchSelector {...defaultProps} onSwitchBranch={onSwitch} />);
    fireEvent.click(screen.getByRole('button', { name: /branch/i }));
    fireEvent.click(screen.getByText('Alternative approach'));
    expect(onSwitch).toHaveBeenCalledWith('b1');
  });

  it('marks active branch in the list', () => {
    render(<BranchSelector {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /branch/i }));
    const allMain = screen.getAllByText('Main');
    const mainOption = allMain[allMain.length - 1].closest('[data-active]');
    expect(mainOption?.getAttribute('data-active')).toBe('true');
  });

  it('shows branch point info for child branches', () => {
    render(<BranchSelector {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /branch/i }));
    expect(screen.getByText(/message 3/i)).toBeDefined();
  });

  it('shows create branch button', () => {
    render(<BranchSelector {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /branch/i }));
    expect(screen.getByText('branching.createNew')).toBeDefined();
  });

  it('calls onDeleteBranch when delete is clicked on a non-main branch', () => {
    const onDelete = vi.fn();
    render(<BranchSelector {...defaultProps} onDeleteBranch={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /branch/i }));
    const deleteButtons = screen.getAllByLabelText('branching.delete');
    fireEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalledWith('b1');
  });

  it('does not show delete button for main branch', () => {
    render(<BranchSelector {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /branch/i }));
    const deleteButtons = screen.getAllByLabelText('branching.delete');
    expect(deleteButtons.length).toBe(2); // only b1 and b2, not main
  });

  it('renders nothing when only one branch exists', () => {
    const { container } = render(
      <BranchSelector {...defaultProps} branches={[branches[0]]} />,
    );
    expect(container.querySelector('[data-testid="branch-count"]')).toBeNull();
  });
});
