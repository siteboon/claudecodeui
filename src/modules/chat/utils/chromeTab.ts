import { authenticatedFetch } from '@/shared/api';

/**
 * Opens a tab in the Chrome the user already has running.
 *
 * Deliberately not a prompt. A slash command in CloudCLI is expanded to text
 * and handed to the agent (`commands.routes.ts` only flags `hasBashCommands`,
 * it never runs anything), so every tool call the agent then makes is a model
 * turn. The browser itself is not the slow part: a cold connection to an open
 * tab measures 1.9 s, a warm one 0.4 s.
 *
 * This is the same split the VS Code extension makes - `@browser:newTab` is a
 * ui message straight to its held MCP client, never a prompt.
 */

export type ChromeTabResult = {
  tabId?: number;
  tabGroupId?: number;
  url?: string;
  /** The tab is open, but the address was refused. */
  warning?: string;
};

export async function openChromeTab(url?: string): Promise<ChromeTabResult> {
  const response = await authenticatedFetch('/api/chrome-tabs/tab', {
    method: 'POST',
    body: JSON.stringify(url ? { url } : {}),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error?.message || payload?.error || 'Chrome could not be reached.',
    );
  }

  return (payload?.data ?? {}) as ChromeTabResult;
}
