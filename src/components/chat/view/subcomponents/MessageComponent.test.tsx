import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import type { ChatMessage } from '../../types/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../llm-logo-provider/SessionProviderLogo', () => ({
  default: () => <div data-testid="provider-logo" />,
}));

vi.mock('./StreamingMarkdown', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('./Markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock('./MessageCopyControl', () => ({
  default: () => <button data-testid="copy-control" />,
}));

vi.mock('../../tools', () => ({
  ToolRenderer: () => <div data-testid="tool-renderer" />,
  shouldHideToolResult: () => false,
}));

vi.mock('../../tools/components/StructuredErrorDisplay', () => ({
  default: () => <div data-testid="structured-error" />,
}));

vi.mock('../../tools/utils/errorClassifier', () => ({
  classifyToolError: () => ({}),
}));

vi.mock('../../../../shared/view/ui', () => ({
  Reasoning: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReasoningTrigger: () => <div />,
  ReasoningContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../utils/chatFormatting', () => ({
  formatUsageLimitText: (text: string) => text,
}));

vi.mock('../../utils/chatPermissions', () => ({
  getClaudePermissionSuggestion: () => null,
}));

import MessageComponent from './MessageComponent';

function makeUserMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    type: 'user',
    content: 'Hello from user',
    timestamp: new Date('2025-06-01T12:00:00Z').toISOString(),
    ...overrides,
  };
}

function makeAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    type: 'assistant',
    content: 'Hello from assistant',
    timestamp: new Date('2025-06-01T12:00:00Z').toISOString(),
    ...overrides,
  };
}

const defaultProps = {
  prevMessage: null,
  createDiff: vi.fn(),
  provider: 'claude' as const,
};

describe('MessageComponent — Phase 5 design system', () => {
  describe('user message warm bubble', () => {
    it('uses warm bg-user-bubble instead of blue', () => {
      const { container } = render(
        <MessageComponent message={makeUserMessage()} {...defaultProps} />,
      );
      const bubble = container.querySelector('.bg-user-bubble');
      expect(bubble).not.toBeNull();
      expect(container.querySelector('.bg-blue-600')).toBeNull();
    });

    it('uses text-foreground instead of text-white', () => {
      const { container } = render(
        <MessageComponent message={makeUserMessage()} {...defaultProps} />,
      );
      const bubble = container.querySelector('.bg-user-bubble');
      expect(bubble).not.toBeNull();
      expect(bubble!.className).toContain('text-foreground');
      expect(bubble!.className).not.toContain('text-white');
    });

    it('has warm border styling', () => {
      const { container } = render(
        <MessageComponent message={makeUserMessage()} {...defaultProps} />,
      );
      const bubble = container.querySelector('.bg-user-bubble');
      expect(bubble).not.toBeNull();
      expect(bubble!.className).toContain('border');
    });

    it('uses rounded-br-md shape for chat bubble tail', () => {
      const { container } = render(
        <MessageComponent message={makeUserMessage()} {...defaultProps} />,
      );
      const bubble = container.querySelector('.bg-user-bubble');
      expect(bubble).not.toBeNull();
      expect(bubble!.className).toContain('rounded-br-md');
    });
  });

  describe('message appear animation', () => {
    it('applies animate-message-appear to user messages', () => {
      const { container } = render(
        <MessageComponent message={makeUserMessage()} {...defaultProps} />,
      );
      expect(container.querySelector('.animate-message-appear')).not.toBeNull();
    });
  });

  describe('assistant message rendering preserved', () => {
    it('renders assistant message content', () => {
      const { container } = render(
        <MessageComponent message={makeAssistantMessage()} {...defaultProps} />,
      );
      expect(container.textContent).toContain('Hello from assistant');
    });
  });
});
