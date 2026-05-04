import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { ChatMessage } from '../../types/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../llm-logo-provider/SessionProviderLogo', () => ({
  default: ({ provider }: { provider: string }) => (
    <div data-testid="provider-logo" data-provider={provider} />
  ),
}));

vi.mock('./StreamingMarkdown', () => ({
  default: ({ content, isStreaming }: { content: string; isStreaming: boolean }) => (
    <div data-testid="streaming-markdown" data-streaming={isStreaming}>
      {content}
    </div>
  ),
}));

vi.mock('./Markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('./MessageActions', () => ({
  default: ({ messageType }: { messageType: string }) => (
    <div data-testid="message-actions" data-message-type={messageType} />
  ),
}));

vi.mock('./MessageCopyControl', () => ({
  default: ({ messageType }: { messageType: string }) => (
    <button data-testid="copy-control" data-message-type={messageType} />
  ),
}));

vi.mock('../../tools', () => ({
  ToolRenderer: ({ toolName, mode }: { toolName: string; mode: string }) => (
    <div data-testid="tool-renderer" data-tool-name={toolName} data-mode={mode} />
  ),
  shouldHideToolResult: () => false,
}));

vi.mock('../../tools/components/StructuredErrorDisplay', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="structured-error">{children}</div>
  ),
}));

vi.mock('../../tools/utils/errorClassifier', () => ({
  classifyToolError: () => ({ category: 'unknown' }),
}));

vi.mock('../../../../shared/view/ui', () => ({
  Reasoning: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="reasoning">{children}</div>
  ),
  ReasoningTrigger: () => <div data-testid="reasoning-trigger" />,
  ReasoningContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="reasoning-content">{children}</div>
  ),
}));

vi.mock('../../utils/chatFormatting', () => ({
  formatUsageLimitText: (text: string) => text,
}));

vi.mock('../../utils/chatPermissions', () => ({
  getClaudePermissionSuggestion: () => null,
}));

import MessageComponent from './MessageComponent';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    type: 'user',
    content: 'Test message',
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
        <MessageComponent message={makeMessage()} {...defaultProps} />,
      );
      expect(container.querySelector('.bg-user-bubble')).not.toBeNull();
      expect(container.querySelector('.bg-blue-600')).toBeNull();
    });

    it('uses text-foreground instead of text-white', () => {
      const { container } = render(
        <MessageComponent message={makeMessage()} {...defaultProps} />,
      );
      const bubble = container.querySelector('.bg-user-bubble')!;
      expect(bubble.className).toContain('text-foreground');
      expect(bubble.className).not.toContain('text-white');
    });

    it('has warm border styling', () => {
      const { container } = render(
        <MessageComponent message={makeMessage()} {...defaultProps} />,
      );
      const bubble = container.querySelector('.bg-user-bubble')!;
      expect(bubble.className).toContain('border');
    });

    it('uses rounded-br-md shape for chat bubble tail', () => {
      const { container } = render(
        <MessageComponent message={makeMessage()} {...defaultProps} />,
      );
      const bubble = container.querySelector('.bg-user-bubble')!;
      expect(bubble.className).toContain('rounded-br-md');
    });

    it('renders user message content text', () => {
      render(
        <MessageComponent message={makeMessage({ content: 'What is TDD?' })} {...defaultProps} />,
      );
      expect(screen.getByText('What is TDD?')).toBeDefined();
    });

    it('renders user avatar with primary styling when not grouped', () => {
      const { container } = render(
        <MessageComponent message={makeMessage()} {...defaultProps} />,
      );
      const avatar = container.querySelector('.bg-primary');
      expect(avatar).not.toBeNull();
      expect(avatar!.textContent).toBe('U');
    });

    it('hides user avatar when grouped with previous user message', () => {
      const prev = makeMessage({ content: 'first' });
      const { container } = render(
        <MessageComponent message={makeMessage({ content: 'second' })} {...defaultProps} prevMessage={prev} />,
      );
      const avatar = container.querySelector('.bg-primary');
      expect(avatar).toBeNull();
    });

    it('shows message actions for non-empty user messages', () => {
      render(
        <MessageComponent message={makeMessage({ content: 'Copy me' })} {...defaultProps} />,
      );
      const actions = screen.getByTestId('message-actions');
      expect(actions.getAttribute('data-message-type')).toBe('user');
    });

    it('renders image attachments', () => {
      const msg = makeMessage({
        images: [{ name: 'screenshot.png', data: 'data:image/png;base64,abc' }],
      });
      const { container } = render(
        <MessageComponent message={msg} {...defaultProps} />,
      );
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe('data:image/png;base64,abc');
    });
  });

  describe('message appear animation', () => {
    it('applies animate-message-appear to user messages', () => {
      const { container } = render(
        <MessageComponent message={makeMessage()} {...defaultProps} />,
      );
      expect(container.querySelector('.animate-message-appear')).not.toBeNull();
    });

    it('applies animate-message-appear to assistant messages', () => {
      const { container } = render(
        <MessageComponent
          message={makeMessage({ type: 'assistant' })}
          {...defaultProps}
        />,
      );
      expect(container.querySelector('.animate-message-appear')).not.toBeNull();
    });
  });

  describe('M2: assistant message no-bubble styling with left border', () => {
    it('has no bubble background on assistant message content area', () => {
      const { container } = render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: 'Hello' })}
          {...defaultProps}
        />,
      );
      // The assistant content wrapper should NOT have any bg- class (transparent)
      const outerWrapper = container.querySelector('.chat-message.assistant');
      expect(outerWrapper).not.toBeNull();
      // No bubble-style background classes on the content area
      const contentArea = outerWrapper!.querySelector('.assistant-content');
      expect(contentArea).not.toBeNull();
      expect(contentArea!.className).not.toContain('bg-');
    });

    it('applies a subtle left border on assistant messages', () => {
      const { container } = render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: 'Hello' })}
          {...defaultProps}
        />,
      );
      const contentArea = container.querySelector('.assistant-content');
      expect(contentArea).not.toBeNull();
      expect(contentArea!.className).toContain('border-l-2');
      expect(contentArea!.className).toContain('border-primary/20');
    });

    it('does not apply left border on tool use messages', () => {
      const { container } = render(
        <MessageComponent
          message={makeMessage({
            type: 'assistant',
            content: '',
            isToolUse: true,
            toolName: 'Bash',
            toolInput: { command: 'ls' },
            toolId: 'tool-1',
            displayText: 'Running...',
          })}
          {...defaultProps}
        />,
      );
      // Tool use messages should not get the assistant-content wrapper
      const contentArea = container.querySelector('.assistant-content');
      expect(contentArea).toBeNull();
    });
  });

  describe('assistant message rendering', () => {
    it('renders assistant text via StreamingMarkdown', () => {
      render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: 'Hello world' })}
          {...defaultProps}
        />,
      );
      const md = screen.getByTestId('streaming-markdown');
      expect(md.textContent).toContain('Hello world');
    });

    it('passes isStreaming flag to StreamingMarkdown', () => {
      render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: 'Thinking...', isStreaming: true })}
          {...defaultProps}
        />,
      );
      const md = screen.getByTestId('streaming-markdown');
      expect(md.getAttribute('data-streaming')).toBe('true');
    });

    it('shows provider logo for non-grouped assistant message', () => {
      render(
        <MessageComponent
          message={makeMessage({ type: 'assistant' })}
          {...defaultProps}
          provider="gemini"
        />,
      );
      const logo = screen.getByTestId('provider-logo');
      expect(logo.getAttribute('data-provider')).toBe('gemini');
    });

    it('shows message actions for assistant messages with content', () => {
      render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: 'Copy this' })}
          {...defaultProps}
        />,
      );
      const actions = screen.getByTestId('message-actions');
      expect(actions.getAttribute('data-message-type')).toBe('assistant');
    });

    it('renders reasoning block when showThinking and reasoning present', () => {
      render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: 'Answer', reasoning: 'I thought about it' })}
          {...defaultProps}
          showThinking={true}
        />,
      );
      expect(screen.getByTestId('reasoning')).toBeDefined();
    });
  });

  describe('tool use messages', () => {
    it('renders ToolRenderer for input when toolInput present', () => {
      render(
        <MessageComponent
          message={makeMessage({
            type: 'assistant',
            content: '',
            isToolUse: true,
            toolName: 'Bash',
            toolInput: { command: 'ls' },
            toolId: 'tool-1',
            displayText: 'Running command...',
          })}
          {...defaultProps}
        />,
      );
      const renderer = screen.getAllByTestId('tool-renderer')[0];
      expect(renderer.getAttribute('data-tool-name')).toBe('Bash');
      expect(renderer.getAttribute('data-mode')).toBe('input');
    });

    it('renders ToolRenderer for result when toolResult present', () => {
      render(
        <MessageComponent
          message={makeMessage({
            type: 'assistant',
            content: '',
            isToolUse: true,
            toolName: 'Read',
            toolInput: { file_path: '/test.ts' },
            toolResult: { content: 'file contents' },
            toolId: 'tool-2',
            displayText: 'Reading file...',
          })}
          {...defaultProps}
        />,
      );
      const renderers = screen.getAllByTestId('tool-renderer');
      expect(renderers.some(r => r.getAttribute('data-mode') === 'result')).toBe(true);
    });

    it('renders StructuredErrorDisplay for tool error results', () => {
      render(
        <MessageComponent
          message={makeMessage({
            type: 'assistant',
            content: '',
            isToolUse: true,
            toolName: 'Bash',
            toolInput: { command: 'bad-cmd' },
            toolResult: { content: 'command not found', isError: true },
            toolId: 'tool-3',
            displayText: 'Running...',
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByTestId('structured-error')).toBeDefined();
    });
  });

  describe('task notification messages', () => {
    it('renders compact task notification with status dot', () => {
      const { container } = render(
        <MessageComponent
          message={makeMessage({
            type: 'assistant',
            content: 'Task completed: setup database',
            isTaskNotification: true,
            taskStatus: 'completed',
          })}
          {...defaultProps}
        />,
      );
      const dot = container.querySelector('.bg-green-400');
      expect(dot).not.toBeNull();
      expect(container.textContent).toContain('Task completed: setup database');
    });

    it('shows amber dot for non-completed tasks', () => {
      const { container } = render(
        <MessageComponent
          message={makeMessage({
            type: 'assistant',
            content: 'Task started',
            isTaskNotification: true,
            taskStatus: 'started',
          })}
          {...defaultProps}
        />,
      );
      expect(container.querySelector('.bg-amber-400')).not.toBeNull();
    });
  });

  describe('thinking messages', () => {
    it('hides thinking message when showThinking is false', () => {
      const { container } = render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: 'Internal thought', isThinking: true })}
          {...defaultProps}
          showThinking={false}
        />,
      );
      expect(container.innerHTML).toBe('');
    });

    it('shows thinking message via Reasoning when showThinking is true', () => {
      render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: 'I am thinking...', isThinking: true })}
          {...defaultProps}
          showThinking={true}
        />,
      );
      expect(screen.getByTestId('reasoning')).toBeDefined();
      expect(screen.getByTestId('markdown').textContent).toContain('I am thinking...');
    });
  });

  describe('error messages', () => {
    it('renders error message with error avatar', () => {
      const { container } = render(
        <MessageComponent
          message={makeMessage({ type: 'error', content: 'Something went wrong' })}
          {...defaultProps}
        />,
      );
      const errorAvatar = container.querySelector('.bg-destructive');
      expect(errorAvatar).not.toBeNull();
      expect(errorAvatar!.textContent).toBe('!');
    });
  });

  describe('JSON content detection', () => {
    it('formats pure JSON content in a code block', () => {
      const jsonContent = JSON.stringify({ name: 'test', value: 42 });
      const { container } = render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: jsonContent })}
          {...defaultProps}
        />,
      );
      const codeBlock = container.querySelector('.bg-code-bg');
      expect(codeBlock).not.toBeNull();
    });

    it('uses bg-code-bg token for JSON code blocks (not bg-gray-800)', () => {
      const jsonContent = JSON.stringify({ key: 'value' });
      const { container } = render(
        <MessageComponent
          message={makeMessage({ type: 'assistant', content: jsonContent })}
          {...defaultProps}
        />,
      );
      expect(container.querySelector('.bg-code-bg')).not.toBeNull();
      expect(container.querySelector('.bg-gray-800')).toBeNull();
    });
  });

  describe('interactive prompt messages', () => {
    it('renders interactive prompt with question styling', () => {
      const { container } = render(
        <MessageComponent
          message={makeMessage({
            type: 'assistant',
            content: 'Do you want to proceed?\n❯ 1. Yes\n  2. No',
            isInteractivePrompt: true,
          })}
          {...defaultProps}
        />,
      );
      expect(container.querySelector('.border-amber-200')).not.toBeNull();
      expect(container.textContent).toContain('Do you want to proceed?');
    });
  });
});
