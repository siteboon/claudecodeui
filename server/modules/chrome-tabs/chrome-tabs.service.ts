import { chromeMcpClient, type ToolResult } from '@/modules/chrome-tabs/chrome-mcp.client.js';
import { AppError } from '@/shared/utils.js';

/**
 * Opening a tab in the user's own Chrome, without asking a model.
 *
 * The slow part of doing this through the agent was never Chrome: a cold MCP
 * start to an open tab measured 1.9 s. What cost the time was every tool call
 * being a model turn. This service is the short way round, the same one the VS
 * Code extension takes for `@browser:newTab`.
 */

export type OpenTabResult = {
  tabId?: number;
  tabGroupId?: number;
  url?: string;
  /** Set when the tab is open but the address could not be loaded. */
  warning?: string;
};

type Tab = { tabId: number; title?: string; url?: string };

/** The tool answers with a line of JSON followed by prose; only the JSON is wanted. */
function readGroup(result: ToolResult): { tabGroupId?: number; tabs: Tab[] } {
  for (const part of result?.content ?? []) {
    if (typeof part?.text !== 'string') {
      continue;
    }

    const start = part.text.indexOf('{');
    if (start < 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(part.text.slice(start, part.text.lastIndexOf('}') + 1));
      return { tabGroupId: parsed.tabGroupId, tabs: Array.isArray(parsed.availableTabs) ? parsed.availableTabs : [] };
    } catch {
      // Not JSON after all - then without ids.
    }
  }

  return { tabs: [] };
}

function readText(result: ToolResult): string {
  return (result?.content ?? [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const chromeTabsService = {
  /**
   * Opens a tab and, if an address is given, loads it there.
   *
   * Measured, and the reason the address is a separate step with a warning
   * rather than a failure: `navigate` is subject to a permission prompt in the
   * Chrome extension itself. Unanswered, it returns "Permission denied by
   * user" after ~30 s - three runs measured 30.1 s, 31.4 s and 31.0 s. Opening
   * the tab is not gated that way, so the tab is reported as open either way.
   */
  async openTab(rawUrl?: string): Promise<OpenTabResult> {
    const url = (rawUrl ?? '').trim();

    // A bare word is not an address, and the Chrome extension asks the user
    // before every navigation - so a stray fragment of the command itself
    // ("bro", left over from picking /browser after typing /bro) turned into a
    // permission prompt for a site that does not exist. Refuse it here instead.
    if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^[^\s/]+\.[^\s/]{2,}/.test(url)) {
      throw new AppError(`"${url}" is not an address.`, {
        code: 'INVALID_URL',
        statusCode: 400,
      });
    }

    // Look before creating. There are two ways a tab comes into being here,
    // and running both is how one click produced two tabs: `createIfEmpty`
    // opens a window with an empty tab when no group exists yet, and
    // `tabs_create_mcp` adds one to a group that does. Which one is needed
    // depends on what is already there, so that is read first - without
    // `createIfEmpty`, so the look itself creates nothing.
    let before: { tabGroupId?: number; tabs: Tab[] };
    try {
      before = readGroup(await chromeMcpClient.callTool('tabs_context_mcp', {}));
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Chrome could not be reached.',
        { code: 'CHROME_UNAVAILABLE', statusCode: 503 },
      );
    }

    let after: { tabGroupId?: number; tabs: Tab[] };
    const known = new Set(before.tabs.map((tab) => tab.tabId));

    if (before.tabs.length === 0) {
      // No group, or a group without tabs: this one call is the whole job, and
      // it is exactly what the VS Code extension does for `@browser:newTab`.
      after = readGroup(await chromeMcpClient.callTool('tabs_context_mcp', { createIfEmpty: true }));
    } else {
      // A group with tabs: `createIfEmpty` would have no effect here ("this
      // parameter has no effect" per its schema). The create call does not
      // report the new id, so the context is read again for it.
      await chromeMcpClient.callTool('tabs_create_mcp', {});
      after = readGroup(await chromeMcpClient.callTool('tabs_context_mcp', {}));
    }

    const created = after.tabs.find((tab) => !known.has(tab.tabId))
      ?? after.tabs[after.tabs.length - 1];

    const opened: OpenTabResult = {
      tabId: created?.tabId,
      tabGroupId: after.tabGroupId ?? before.tabGroupId,
    };

    if (!url) {
      return opened;
    }

    if (created?.tabId === undefined) {
      return { ...opened, warning: 'The new tab reported no id, so the address was not loaded.' };
    }

    const navigation = await chromeMcpClient.callTool('navigate', { url, tabId: created.tabId });
    if (navigation.isError) {
      const reported = readText(navigation);
      return {
        ...opened,
        warning: /permission/i.test(reported)
          ? 'The tab is open. Chrome refused the address: confirm the request in the Claude extension.'
          : `The tab is open, but the address was refused: ${reported}`,
      };
    }

    return { ...opened, url };
  },

  /** Whether a connection is currently held. */
  getStatus(): { connected: boolean } {
    return { connected: chromeMcpClient.isConnected() };
  },
};
