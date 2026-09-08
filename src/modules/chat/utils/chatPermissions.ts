import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult } from '@/shared/types';
import { getClaudeSettings, saveClaudePermissions } from '@/modules/chat/utils/chatStorage';

export function buildClaudeToolPermissionEntry(toolName?: string, toolInput?: unknown) {
  if (!toolName) return null;
  if (toolName !== 'Bash') return toolName;

  let parsed: unknown = toolInput;
  if (typeof toolInput === 'string') {
    try {
      parsed = JSON.parse(toolInput) as unknown;
    } catch {
      return toolName;
    }
  }

  const command = parsed && typeof parsed === 'object' && 'command' in parsed && typeof parsed.command === 'string'
    ? parsed.command.trim()
    : '';
  if (!command) return toolName;

  const tokens = command.split(/\s+/);
  if (tokens.length === 0) return toolName;

  if (tokens[0] === 'git' && tokens[1]) {
    return `Bash(${tokens[0]} ${tokens[1]}:*)`;
  }
  return `Bash(${tokens[0]}:*)`;
}

export function formatToolInputForDisplay(input: unknown) {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function getClaudePermissionSuggestion(
  message: ChatMessage | null | undefined,
  provider: string,
): ClaudePermissionSuggestion | null {
  if (provider !== 'claude') return null;
  if (!message?.toolResult?.isError) return null;

  const toolName = message?.toolName;
  const entry = buildClaudeToolPermissionEntry(toolName, message.toolInput);
  if (!entry) return null;

  const settings = getClaudeSettings();
  const isAllowed = settings.allowedTools.includes(entry);
  return { toolName: toolName || 'UnknownTool', entry, isAllowed };
}

export function grantClaudeToolPermission(entry: string | null): PermissionGrantResult {
  if (!entry) return { success: false };

  const settings = getClaudeSettings();
  const alreadyAllowed = settings.allowedTools.includes(entry);
  const nextAllowed = alreadyAllowed ? settings.allowedTools : [...settings.allowedTools, entry];
  const nextDisallowed = settings.disallowedTools.filter((tool) => tool !== entry);
  const updatedSettings = {
    ...settings,
    allowedTools: nextAllowed,
    disallowedTools: nextDisallowed,
  };

  saveClaudePermissions({
    allowedTools: nextAllowed,
    disallowedTools: nextDisallowed,
    skipPermissions: settings.skipPermissions,
  });
  return { success: true, alreadyAllowed, updatedSettings };
}
