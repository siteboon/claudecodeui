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

/** The file a tool call worked on: its tool config's, else the raw input's (MultiEdit, NotebookEdit). */
function toolFilePath(message: ChatMessage): string | undefined {
  const input = (parseToolPayload(message.toolInput) ?? {}) as Record<string, unknown>;
  const contentProps = getToolConfig(message.toolName || 'Tool').input.getContentProps?.(input) as
    Record<string, unknown> | undefined;
  const filePath = contentProps?.filePath ?? input.file_path ?? input.notebook_path;
  return typeof filePath === 'string' ? filePath : undefined;
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

type BuildHandoffMarkdownInput = {
  messages: ChatMessage[];
  sessionTitle: string;
  provider: LLMProvider | string;
  maxChars?: number;
};

/**
 * Condenses a transcript into a first message for a new chat, so the work can
 * continue with another provider once this one hits its usage limit. Keeps the
 * original task, the files touched and as many recent turns as fit; drops tool
 * payloads, results and thinking, which are most of the tokens.
 *
 * shortcut: a character cap stands in for a token budget; switch to a real
 * token count if users need it to match a provider's limit exactly.
 */
export function buildHandoffMarkdown({
  messages,
  sessionTitle,
  provider,
  maxChars = 16000,
}: BuildHandoffMarkdownInput): string {
  const providerLabel = PROVIDER_LABELS[String(provider)] ?? 'Assistant';
  const files = new Set<string>();
  const turns: Array<{ isUser: boolean; text: string }> = [];

  for (const message of messages) {
    if (message.isToolUse) {
      const filePath = toolFilePath(message);
      if (filePath) files.add(filePath);
      continue;
    }
    if (message.isThinking || message.isLocalCommand || message.isLocalCommandStdout) continue;
    if (message.type !== 'user' && message.type !== 'assistant') continue;
    // A compaction row keeps its summary of everything before it apart from the content.
    let text = message.compactSummary
      ? `Summary of the earlier conversation:\n\n${message.compactSummary.trim()}`
      : readString(message.content).trim();
    const attachments = (message.images?.length ?? 0) + (message.files?.length ?? 0);
    if (attachments > 0) text = `${text}\n\n_[${attachments} attachment(s) not carried over]_`.trim();
    if (text) turns.push({ isUser: message.type === 'user', text });
  }

  const taskIndex = turns.findIndex((turn) => turn.isUser);
  const head = [
    `I am continuing a ${providerLabel} session ("${sessionTitle}") here. The context is below. Pick up where it left off.`,
  ];
  if (taskIndex >= 0) {
    const task = turns[taskIndex].text;
    const taskCap = Math.floor(maxChars / 4);
    head.push('', '## Original task', '', task.length > taskCap ? `${task.slice(0, taskCap)}…` : task);
  }
  if (files.size > 0) {
    // The newest paths, capped so a sweeping refactor cannot crowd out the conversation.
    const shown = [...files].slice(-40);
    head.push('', '## Files touched', '', ...shown.map((file) => `- \`${file}\``));
    if (files.size > shown.length) head.push(`- _…${files.size - shown.length} more_`);
  }

  // Newest turns first until the budget runs out, then back into reading order.
  // 80 reserves room for the section heading and the omitted-turns marker.
  let budget = maxChars - head.join('\n').length - 80;
  const recent: string[] = [];
  for (let index = turns.length - 1; index > taskIndex; index -= 1) {
    const turn = turns[index];
    const heading = `### ${turn.isUser ? 'User' : providerLabel}\n\n`;
    const block = `${heading}${turn.text}`;
    if (block.length + 2 > budget) {
      // The latest turn matters most and ends with where it got to, so keep its tail.
      if (recent.length === 0 && budget > 200) {
        recent.unshift(`${heading}…${turn.text.slice(-(budget - heading.length - 4))}`);
      }
      break;
    }
    budget -= block.length + 2;
    recent.unshift(block);
  }

  const omitted = turns.length - (taskIndex + 1) - recent.length;
  const sections = [...head];
  if (recent.length > 0 || omitted > 0) {
    sections.push('', '## Latest conversation');
    if (omitted > 0) sections.push('', `_…${omitted} earlier turn(s) omitted_`);
    for (const block of recent) sections.push('', block);
  }

  return sections.join('\n');
}
