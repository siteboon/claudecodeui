import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TranscriptRenderContext } from '@/modules/chat/context/TranscriptRenderContext';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';

const OUTPUT = 'synthetic tool output '.repeat(3000);
const RESULT = { content: OUTPUT, isError: false };
const tool = (
  <ToolRenderer toolName="mcp__example__read" toolInput="{}" toolResult={RESULT} mode="result" />
);

describe('collapsed generic tool output', () => {
  it('mounts large output only while expanded without changing the result', () => {
    render(tool);
    expect(screen.queryByText(OUTPUT.trim())).toBeNull();

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(OUTPUT.trim())).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByText(OUTPUT.trim())).toBeNull();
    expect(RESULT.content).toBe(OUTPUT);
  });

  it('includes output in transcript exports without requiring a click', () => {
    render(
      <TranscriptRenderContext.Provider value={{ isExporting: true }}>
        {tool}
      </TranscriptRenderContext.Provider>,
    );
    expect(screen.getByText(OUTPUT.trim())).toBeTruthy();
  });
});
