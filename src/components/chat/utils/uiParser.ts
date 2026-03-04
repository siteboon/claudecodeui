export type UiParsedMessage =
  | { kind: 'skip' }
  | { kind: 'taskNotification'; summary: string; status: string }
  | { kind: 'text'; content: string };

const SKIP_PREFIXES = [
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command-stdout>',
  '<system-reminder>',
  'Caveat:',
  'This session is being continued from a previous',
  '[Request interrupted',
];

const TASK_NOTIFICATION_REGEX =
  /<task-notification>\s*<task-id>[^<]*<\/task-id>\s*<output-file>[^<]*<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/;

export function parseUiMessageContent(rawContent: string): UiParsedMessage {
  const content = rawContent.trim();
  if (!content) {
    return { kind: 'skip' };
  }

  for (const prefix of SKIP_PREFIXES) {
    if (content.startsWith(prefix)) {
      return { kind: 'skip' };
    }
  }

  const taskMatch = content.match(TASK_NOTIFICATION_REGEX);
  if (taskMatch) {
    return {
      kind: 'taskNotification',
      status: taskMatch[1]?.trim() || 'completed',
      summary: taskMatch[2]?.trim() || 'Background task finished',
    };
  }

  return { kind: 'text', content };
}

