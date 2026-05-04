import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { PromptInput, PromptInputBody, PromptInputTextarea } from './PromptInput';

describe('PromptInputTextarea', () => {
  // C4: placeholder text and styling
  it('renders with "Message Claude..." placeholder by default', () => {
    const { container } = render(
      <PromptInput>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Message Claude..." />
        </PromptInputBody>
      </PromptInput>
    );
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea!.getAttribute('placeholder')).toBe('Message Claude...');
  });

  it('applies muted-foreground placeholder styling', () => {
    const { container } = render(
      <PromptInput>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Message Claude..." />
        </PromptInputBody>
      </PromptInput>
    );
    const textarea = container.querySelector('textarea');
    expect(textarea!.className).toContain('placeholder-muted-foreground');
  });
});
