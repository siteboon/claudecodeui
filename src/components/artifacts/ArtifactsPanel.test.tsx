import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ArtifactsPanel from './ArtifactsPanel';
import ArtifactViewer from './ArtifactViewer';
import type { Artifact } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const artifacts: Artifact[] = [
  {
    id: 'a1',
    title: 'API Handler',
    type: 'code',
    language: 'typescript',
    content: 'export function handler() { return "ok"; }',
    versions: [
      { id: 'v1', content: 'export function handler() {}', createdAt: '2025-06-01T00:00:00Z' },
      { id: 'v2', content: 'export function handler() { return "ok"; }', createdAt: '2025-06-01T01:00:00Z' },
    ],
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2025-06-01T01:00:00Z',
  },
  {
    id: 'a2',
    title: 'Project README',
    type: 'document',
    content: '# Project\n\nThis is the readme.',
    versions: [],
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
  },
  {
    id: 'a3',
    title: 'Architecture Diagram',
    type: 'canvas',
    content: '<svg></svg>',
    versions: [],
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
  },
];

describe('ArtifactsPanel', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    artifacts,
    onSelectArtifact: vi.fn(),
    onExport: vi.fn(),
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<ArtifactsPanel {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders panel title when open', () => {
    render(<ArtifactsPanel {...defaultProps} />);
    expect(screen.getByText('artifacts.title')).toBeDefined();
  });

  it('renders all artifacts in the list', () => {
    render(<ArtifactsPanel {...defaultProps} />);
    expect(screen.getByText('API Handler')).toBeDefined();
    expect(screen.getByText('Project README')).toBeDefined();
    expect(screen.getByText('Architecture Diagram')).toBeDefined();
  });

  it('shows type indicator for each artifact', () => {
    const { container } = render(<ArtifactsPanel {...defaultProps} />);
    expect(container.querySelectorAll('[data-testid="artifact-type"]').length).toBe(3);
  });

  it('calls onSelectArtifact when an artifact is clicked', () => {
    const onSelect = vi.fn();
    render(<ArtifactsPanel {...defaultProps} onSelectArtifact={onSelect} />);
    fireEvent.click(screen.getByText('API Handler'));
    expect(onSelect).toHaveBeenCalledWith('a1');
  });

  it('highlights the active artifact', () => {
    const { container } = render(<ArtifactsPanel {...defaultProps} activeArtifactId="a2" />);
    const active = container.querySelector('[data-active="true"]');
    expect(active).not.toBeNull();
    expect(active!.textContent).toContain('Project README');
  });

  it('shows empty state when no artifacts', () => {
    render(<ArtifactsPanel {...defaultProps} artifacts={[]} />);
    expect(screen.getByText('artifacts.empty')).toBeDefined();
  });

  it('shows language badge for code artifacts', () => {
    render(<ArtifactsPanel {...defaultProps} />);
    expect(screen.getByText('typescript')).toBeDefined();
  });
});

describe('ArtifactViewer', () => {
  const codeArtifact = artifacts[0];
  const docArtifact = artifacts[1];

  it('renders artifact title', () => {
    render(<ArtifactViewer artifact={codeArtifact} onClose={() => {}} />);
    expect(screen.getByText('API Handler')).toBeDefined();
  });

  it('renders code content in a pre/code block for code artifacts', () => {
    const { container } = render(<ArtifactViewer artifact={codeArtifact} onClose={() => {}} />);
    const codeEl = container.querySelector('code');
    expect(codeEl).not.toBeNull();
    expect(codeEl!.textContent).toContain('handler');
  });

  it('renders document content as markdown for document artifacts', () => {
    const { container } = render(<ArtifactViewer artifact={docArtifact} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="artifact-markdown"]')).not.toBeNull();
  });

  it('shows version selector when versions exist', () => {
    render(<ArtifactViewer artifact={codeArtifact} onClose={() => {}} />);
    expect(screen.getByText(/v1/)).toBeDefined();
    expect(screen.getByText(/v2/)).toBeDefined();
  });

  it('calls onVersionSelect when a version is clicked', () => {
    const onVersion = vi.fn();
    render(<ArtifactViewer artifact={codeArtifact} onClose={() => {}} onVersionSelect={onVersion} />);
    fireEvent.click(screen.getByText(/v1/));
    expect(onVersion).toHaveBeenCalledWith('v1');
  });

  it('shows export button and calls onExport', () => {
    const onExport = vi.fn();
    render(<ArtifactViewer artifact={codeArtifact} onClose={() => {}} onExport={onExport} />);
    fireEvent.click(screen.getByLabelText('artifacts.export'));
    expect(onExport).toHaveBeenCalled();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<ArtifactViewer artifact={codeArtifact} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('artifacts.close'));
    expect(onClose).toHaveBeenCalled();
  });
});
