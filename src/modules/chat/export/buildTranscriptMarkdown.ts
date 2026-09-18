import type { ChatMessage, DiffLine, LLMProvider } from '@/shared/types';
import { getToolConfig } from '@/modules/chat/tools';
import { parseToolPayload, summarizeDiff } from '@/modules/chat/utils/messageTransforms';

type BuildTranscriptMarkdownInput = {
  messages: ChatMessage[];
  sessionTitle: string;
  provider: LLMProvider | string;
  exportedAt: Date;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

/** Fenced blocks need a longer fence than anything they contain. */
function fence(content: string): string {
  const longestRun = [...content.matchAll(/`{3,}/g)].reduce(
    (longest, match) => Math.max(longest, match[0].length),
    2,
  );
  return '`'.repeat(longestRun + 1);
}

function codeBlock(content: string, language = ''): string {
  const marker = fence(content);
  return `${marker}${language}\n${content}\n${marker}`;
}

function readString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

/**
 * Renders one tool call the way the transcript summarizes it: what ran, on
 * what, and what came back.
 *
 * The previous exporter branched on `msg.type` alone, and a tool call is typed
 * `assistant` with empty content — so every one of them, which on an agent
 * transcript is most of the file, exported as a blank section.
 */
function renderToolCall(
  message: ChatMessage,
  createDiff: (oldStr: string, newStr: string) => DiffLine[],
): string {
  const toolName = message.toolName || 'Tool';
  const input = parseToolPayload(message.toolInput);
  const config = getToolConfig(toolName).input;
  const lines: string[] = [];

  const contentProps = config.getContentProps?.(input ?? {}) as Record<string, unknown> | undefined;
  const filePath = typeof contentProps?.filePath === 'string' ? contentProps.filePath : undefined;

  lines.push(`**\`${toolName}\`**${filePath ? ` — \`${filePath}\`` : ''}`);

  if (
    config.contentType === 'diff'
    && typeof contentProps?.oldContent === 'string'
    && typeof contentProps?.newContent === 'string'
  ) {
    const diffLines = createDiff(contentProps.oldContent, contentProps.newContent);
    const stats = summarizeDiff(diffLines);
    lines.push('', `\`+${stats.added} -${stats.removed}\``);
    lines.push('', codeBlock(
      diffLines.map((line) => `${line.type === 'added' ? '+' : '-'}${line.content}`).join('\n'),
      'diff',
    ));
  } else {
    const rendered = readString(input);
    if (rendered.trim()) {
      lines.push('', codeBlock(rendered, rendered.trimStart().startsWith('{') ? 'json' : ''));
    }
  }

  const result = readString(message.toolResult?.content);
  if (result.trim()) {
    lines.push('', message.toolResult?.isError ? '_Failed:_' : '_Result:_', '', codeBlock(result));
  }

  return lines.join('\n');
}

/**
 * Renders a transcript as Markdown that reads well in a plain text editor and
 * on any Markdown host, with tool calls, diffs and thinking blocks intact.
 */
export function buildTranscriptMarkdown(input: BuildTranscriptMarkdownInput): string {
  const providerLabel = PROVIDER_LABELS[String(input.provider)] ?? 'Assistant';
  const sections: string[] = [
    `# ${input.sessionTitle}`,
    '',
    `_${input.messages.length} messages · exported ${input.exportedAt.toLocaleString()}_`,
    '',
    '---',
  ];

  for (const message of input.messages) {
    sections.push('');

    if (message.isToolUse) {
      sections.push(renderToolCall(message, input.createDiff));
      continue;
    }

    if (message.type === 'user') {
      sections.push(`### You`);
      sections.push('', readString(message.content));
      if (message.images?.length) {
        sections.push('', `_${message.images.length} image attachment(s)_`);
      }
      if (message.files?.length) {
        sections.push('', `_Attached: ${message.files.map((file) => file.name).join(', ')}_`);
      }
      continue;
    }

    if (message.type === 'error') {
      sections.push('### Error', '', codeBlock(readString(message.content)));
      continue;
    }

    if (message.isThinking) {
      sections.push(`### ${providerLabel} — thinking`, '', readString(message.content));
      continue;
    }

    sections.push(`### ${providerLabel}`);
    if (message.reasoning) {
      sections.push('', '<details><summary>Reasoning</summary>', '', readString(message.reasoning), '', '</details>');
    }
    sections.push('', readString(message.content));
  }

  return `${sections.join('\n').replace(/\n{4,}/g, '\n\n\n')}\n`;
}
