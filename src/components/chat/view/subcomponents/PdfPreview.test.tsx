import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PdfPreview from './PdfPreview';

describe('PdfPreview', () => {
  it('renders with testid', () => {
    render(<PdfPreview url="/test.pdf" />);
    expect(screen.getByTestId('pdf-preview')).toBeDefined();
  });

  it('shows filename when provided', () => {
    render(<PdfPreview url="/test.pdf" filename="report.pdf" />);
    expect(screen.getByText('report.pdf')).toBeDefined();
  });

  it('extracts filename from url when not provided', () => {
    render(<PdfPreview url="/files/document.pdf" />);
    expect(screen.getByText('document.pdf')).toBeDefined();
  });

  it('renders an iframe with the PDF url', () => {
    const { container } = render(<PdfPreview url="/test.pdf" />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeDefined();
    expect(iframe!.src).toContain('/test.pdf');
  });

  it('has open-in-new-tab link', () => {
    render(<PdfPreview url="/test.pdf" />);
    const link = screen.getByTitle('Open in new tab');
    expect(link).toBeDefined();
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('sandboxes the iframe', () => {
    const { container } = render(<PdfPreview url="/test.pdf" />);
    const iframe = container.querySelector('iframe');
    expect(iframe!.getAttribute('sandbox')).toBe('allow-same-origin');
  });
});
