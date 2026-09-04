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

/**
 * Says something only when there is something to say.
 *
 * The tab opening is its own confirmation - it is right there on the screen -
 * but a refused address is not: the request answers 200 with the tab's id and a
 * `warning`, and without this the address silently did not load.
 */
export async function reportChromeTab(
  opening: Promise<ChromeTabResult>,
  addMessage: (message: { type: 'assistant'; content: string; timestamp: number }) => void,
): Promise<void> {
  try {
    const result = await opening;
    if (result.warning) {
      addMessage({ type: 'assistant', content: result.warning, timestamp: Date.now() });
    }
  } catch (error) {
    addMessage({
      type: 'assistant',
      content: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    });
  }
}

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
