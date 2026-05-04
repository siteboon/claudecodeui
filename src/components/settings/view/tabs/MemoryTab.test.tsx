import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MemoryTab from './MemoryTab';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

describe('MemoryTab', () => {
  beforeEach(() => {
    localStorage.removeItem('memories');
  });

  it('renders the memory tab with add button', () => {
    render(<MemoryTab />);
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('shows empty state when no memories', () => {
    render(<MemoryTab />);
    expect(screen.getByText(/no memories/i)).toBeInTheDocument();
  });

  it('adds a new memory', () => {
    render(<MemoryTab />);
    const input = screen.getByPlaceholderText(/add a memory/i);
    fireEvent.change(input, { target: { value: 'New memory' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByText('New memory')).toBeInTheDocument();
  });

  it('deletes a memory', () => {
    localStorage.setItem('memories', JSON.stringify([
      { id: '1', content: 'Delete me', createdAt: '2024-01-01', enabled: true },
    ]));
    render(<MemoryTab />);
    expect(screen.getByText('Delete me')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
  });

  it('toggles a memory', () => {
    localStorage.setItem('memories', JSON.stringify([
      { id: '1', content: 'Toggle me', createdAt: '2024-01-01', enabled: true },
    ]));
    render(<MemoryTab />);
    const toggle = screen.getByRole('checkbox');
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });
});
