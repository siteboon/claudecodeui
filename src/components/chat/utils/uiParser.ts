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

const normalizeTaskStatus = (rawStatus: string | undefined): string => {
  const status = (rawStatus || '').trim().toLowerCase();
  if (!status) return 'completed';

  if (['done', 'success', 'ok', 'completed', 'complete'].includes(status)) {
    return 'completed';
  }
  if (['failed', 'failure', 'error', 'errored'].includes(status)) {
    return 'failed';
  }
  if (['running', 'in_progress', 'in progress', 'processing'].includes(status)) {
    return 'running';
  }
  return status;
};

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
      status: normalizeTaskStatus(taskMatch[1]),
      summary: taskMatch[2]?.trim() || 'Background task finished',
    };
  }

  return { kind: 'text', content };
}
