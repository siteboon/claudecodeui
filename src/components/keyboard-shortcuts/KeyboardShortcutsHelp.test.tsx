import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('KeyboardShortcutsHelp', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<KeyboardShortcutsHelp isOpen={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders panel title when open', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('shortcuts.title')).toBeDefined();
  });

  it('shows shortcut categories', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('shortcuts.general')).toBeDefined();
    expect(screen.getByText('shortcuts.chat')).toBeDefined();
  });

  it('shows Ctrl+N for new chat', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Ctrl+N')).toBeDefined();
  });

  it('shows Ctrl+, for settings', () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Ctrl+,')).toBeDefined();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsHelp isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('shortcuts.close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsHelp isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
