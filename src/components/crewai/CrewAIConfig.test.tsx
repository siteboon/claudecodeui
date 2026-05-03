import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import CrewAIConfig from './CrewAIConfig';

describe('CrewAIConfig', () => {
  it('renders mode selector with local, cloud, and hybrid options', () => {
    render(<CrewAIConfig onSave={() => {}} />);
    expect(screen.getByText(/mode/i)).toBeDefined();
    expect(screen.getByRole('combobox')).toBeDefined();
  });

  it('shows project path input when mode is local', () => {
    render(<CrewAIConfig onSave={() => {}} initialMode="local" />);
    expect(screen.getByLabelText(/project path/i)).toBeDefined();
  });

  it('shows API key input when mode is cloud', () => {
    render(<CrewAIConfig onSave={() => {}} initialMode="cloud" />);
    expect(screen.getByLabelText(/api key/i)).toBeDefined();
  });

  it('calls onSave with config when save button is clicked', () => {
    const onSave = vi.fn();
    render(<CrewAIConfig onSave={onSave} initialMode="local" initialProjectPath="/my/crew" />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'local',
        localProjectPath: '/my/crew',
      }),
    );
  });

  it('shows both project path and API key in hybrid mode', () => {
    render(<CrewAIConfig onSave={() => {}} initialMode="hybrid" />);
    expect(screen.getByLabelText(/project path/i)).toBeDefined();
    expect(screen.getByLabelText(/api key/i)).toBeDefined();
  });
});
