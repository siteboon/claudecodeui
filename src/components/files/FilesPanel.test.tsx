import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import FilesPanel from './FilesPanel';
import type { FileEntry } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const sampleTree: FileEntry[] = [
  {
    name: 'src',
    path: '/project/src',
    type: 'directory',
    children: [
      { name: 'index.ts', path: '/project/src/index.ts', type: 'file', size: 1024 },
      { name: 'utils.ts', path: '/project/src/utils.ts', type: 'file', size: 512 },
    ],
  },
  { name: 'README.md', path: '/project/README.md', type: 'file', size: 2048 },
  { name: 'package.json', path: '/project/package.json', type: 'file', size: 256 },
];

describe('FilesPanel', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <FilesPanel projectPath="/project" isOpen={false} onClose={() => {}} files={sampleTree} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders panel with title when open', () => {
    render(
      <FilesPanel projectPath="/project" isOpen={true} onClose={() => {}} files={sampleTree} />,
    );
    expect(screen.getByText('files.title')).toBeDefined();
  });

  it('renders top-level files and directories', () => {
    render(
      <FilesPanel projectPath="/project" isOpen={true} onClose={() => {}} files={sampleTree} />,
    );
    expect(screen.getByText('src')).toBeDefined();
    expect(screen.getByText('README.md')).toBeDefined();
    expect(screen.getByText('package.json')).toBeDefined();
  });

  it('expands a directory when clicked to show children', () => {
    render(
      <FilesPanel projectPath="/project" isOpen={true} onClose={() => {}} files={sampleTree} />,
    );
    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('index.ts')).toBeDefined();
    expect(screen.getByText('utils.ts')).toBeDefined();
  });

  it('calls onFileSelect when a file is clicked', () => {
    const onFileSelect = vi.fn();
    render(
      <FilesPanel
        projectPath="/project"
        isOpen={true}
        onClose={() => {}}
        files={sampleTree}
        onFileSelect={onFileSelect}
      />,
    );
    fireEvent.click(screen.getByText('README.md'));
    expect(onFileSelect).toHaveBeenCalledWith('/project/README.md');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <FilesPanel projectPath="/project" isOpen={true} onClose={onClose} files={sampleTree} />,
    );
    fireEvent.click(screen.getByLabelText('files.close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('filters files when search query is entered', () => {
    render(
      <FilesPanel projectPath="/project" isOpen={true} onClose={() => {}} files={sampleTree} />,
    );
    const searchInput = screen.getByPlaceholderText('files.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'README' } });
    expect(screen.getByText('README.md')).toBeDefined();
    expect(screen.queryByText('package.json')).toBeNull();
  });

  it('shows empty state when no files match search', () => {
    render(
      <FilesPanel projectPath="/project" isOpen={true} onClose={() => {}} files={sampleTree} />,
    );
    const searchInput = screen.getByPlaceholderText('files.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    expect(screen.getByText('files.noResults')).toBeDefined();
  });

  it('shows file size for file entries', () => {
    render(
      <FilesPanel projectPath="/project" isOpen={true} onClose={() => {}} files={sampleTree} />,
    );
    expect(screen.getByText('2.0 KB')).toBeDefined();
  });

  it('renders directory icon for directories and file icon for files', () => {
    const { container } = render(
      <FilesPanel projectPath="/project" isOpen={true} onClose={() => {}} files={sampleTree} />,
    );
    expect(container.querySelectorAll('[data-icon="folder"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-icon="file"]').length).toBeGreaterThan(0);
  });

  it('shows upload drop zone text', () => {
    render(
      <FilesPanel projectPath="/project" isOpen={true} onClose={() => {}} files={sampleTree} />,
    );
    expect(screen.getByText('files.dropToUpload')).toBeDefined();
  });
});
