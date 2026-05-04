import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArtifactToggle from './ArtifactToggle';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ArtifactToggle', () => {
  it('renders a button with artifact count badge', () => {
    render(<ArtifactToggle count={3} isOpen={false} onToggle={() => {}} />);
    expect(screen.getByRole('button')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });

  it('hides badge when count is 0', () => {
    render(<ArtifactToggle count={0} isOpen={false} onToggle={() => {}} />);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<ArtifactToggle count={1} isOpen={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('applies active styling when isOpen', () => {
    const { container } = render(<ArtifactToggle count={1} isOpen={true} onToggle={() => {}} />);
    expect(container.querySelector('[data-active="true"]')).not.toBeNull();
  });
});
