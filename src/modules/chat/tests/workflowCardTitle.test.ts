import { describe, expect, it } from 'vitest';

import { TOOL_CONFIGS } from '@/modules/chat/tools/configs/toolConfigs';

const title = (input: unknown): string => {
  const configured = TOOL_CONFIGS.Workflow.input.title;
  return typeof configured === 'function' ? configured(input) : String(configured);
};

describe('the Workflow card title', () => {
  it('names the workflow from the script it runs', () => {
    const script = [
      "export const meta = {",
      "  name: 'review-changes',",
      "  description: 'Review changed files across dimensions',",
      "}",
      "const DIMENSIONS = [{ key: 'bugs', name: 'not the workflow name' }]",
    ].join('\n');

    expect(title({ script })).toBe('Workflow: review-changes');
  });

  it('names a saved workflow selected by name, which carries no script', () => {
    expect(title({ name: 'spec' })).toBe('Workflow: spec');
  });

  it('falls back when the script declares no name', () => {
    expect(title({ script: 'const x = 1' })).toBe('Workflow script');
  });
});
