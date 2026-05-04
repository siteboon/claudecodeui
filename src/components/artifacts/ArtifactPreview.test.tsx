import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArtifactPreview from './ArtifactPreview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ArtifactPreview', () => {
  it('renders an iframe with sandbox attribute for HTML content', () => {
    const { container } = render(
      <ArtifactPreview type="html" content="<h1>Hello</h1>" />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('sets iframe srcdoc to wrapped HTML content', () => {
    const { container } = render(
      <ArtifactPreview type="html" content="<h1>Hello</h1>" />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe!.getAttribute('srcdoc')).toContain('<h1>Hello</h1>');
  });

  it('renders SVG content directly for svg type', () => {
    const { container } = render(
      <ArtifactPreview type="svg" content='<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>' />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe!.getAttribute('srcdoc')).toContain('<svg');
  });

  it('wraps React/JSX in a basic HTML shell', () => {
    const { container } = render(
      <ArtifactPreview type="react" content="function App() { return <div>Hi</div>; }" />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe!.getAttribute('srcdoc')).toContain('react');
  });

  it('renders mermaid content with mermaid script tag', () => {
    const { container } = render(
      <ArtifactPreview type="mermaid" content="graph TD\n  A-->B" />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe!.getAttribute('srcdoc')).toContain('mermaid');
  });
});

describe('ArtifactPreview actions', () => {
  it('renders copy button and calls onCopy', () => {
    const onCopy = vi.fn();
    render(<ArtifactPreview type="html" content="<h1>Hi</h1>" onCopy={onCopy} />);
    fireEvent.click(screen.getByLabelText('artifacts.copy'));
    expect(onCopy).toHaveBeenCalled();
  });

  it('renders download button and calls onDownload', () => {
    const onDownload = vi.fn();
    render(<ArtifactPreview type="html" content="<h1>Hi</h1>" onDownload={onDownload} />);
    fireEvent.click(screen.getByLabelText('artifacts.download'));
    expect(onDownload).toHaveBeenCalled();
  });

  it('renders open-in-new-tab button and calls onOpenNewTab', () => {
    const onOpenNewTab = vi.fn();
    render(<ArtifactPreview type="html" content="<h1>Hi</h1>" onOpenNewTab={onOpenNewTab} />);
    fireEvent.click(screen.getByLabelText('artifacts.openNewTab'));
    expect(onOpenNewTab).toHaveBeenCalled();
  });
});
