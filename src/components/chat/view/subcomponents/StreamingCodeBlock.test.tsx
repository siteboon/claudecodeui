import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StreamingCodeBlock from './StreamingCodeBlock';

describe('StreamingCodeBlock', () => {
  it('renders code content', () => {
    const { container } = render(<StreamingCodeBlock source="console.log('hi')" language="javascript" />);
    expect(container.textContent).toContain("console.log('hi')");
  });

  it('shows language label for non-text languages', () => {
    render(<StreamingCodeBlock source="echo hello" language="bash" />);
    expect(screen.getByText('bash')).toBeDefined();
  });

  it('shows copy button on hover', () => {
    const { container } = render(<StreamingCodeBlock source="echo test" language="bash" />);
    const copyBtn = container.querySelector('button[title="Copy code"]');
    expect(copyBtn).toBeDefined();
  });

  it('shows Run in Shell button for bash language', () => {
    render(<StreamingCodeBlock source="echo hello" language="bash" />);
    const runBtn = screen.getByTitle('Run in Shell');
    expect(runBtn).toBeDefined();
  });

  it('shows Run in Shell button for sh language', () => {
    render(<StreamingCodeBlock source="ls -la" language="sh" />);
    expect(screen.getByTitle('Run in Shell')).toBeDefined();
  });

  it('shows Run in Shell button for powershell language', () => {
    render(<StreamingCodeBlock source="Get-Process" language="powershell" />);
    expect(screen.getByTitle('Run in Shell')).toBeDefined();
  });

  it('does NOT show Run in Shell button for javascript', () => {
    render(<StreamingCodeBlock source="const x = 1" language="javascript" />);
    expect(screen.queryByTitle('Run in Shell')).toBeNull();
  });

  it('calls onRunInShell callback when Run in Shell is clicked', () => {
    const onRun = vi.fn();
    render(<StreamingCodeBlock source="echo hello" language="bash" onRunInShell={onRun} />);
    fireEvent.click(screen.getByTitle('Run in Shell'));
    expect(onRun).toHaveBeenCalledWith('echo hello');
  });
});
