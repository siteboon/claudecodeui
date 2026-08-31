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

/**
 * Openings run one after another.
 *
 * Which tab was just created is worked out by comparing the group before and
 * after, and that comparison is only true if nothing else creates a tab in
 * between. Two requests arriving together would otherwise both see the other's
 * tab as "new" - or neither would, and the one that lost would navigate a page
 * the user has open. The whole sequence is short (0.25 s warm), so a queue
 * costs nothing worth having.
 */
let pending: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = pending.then(task, task);
  // The chain must not stay rejected, or every later opening inherits it.
  pending = next.catch(() => undefined);
  return next;
}

/**
 * Whether this is something Chrome can be asked to open.
 *
 * A bare word is not an address, and the Chrome extension asks the user before
 * every navigation - so a stray fragment of the command itself ("bro", left
 * over from picking /browser after typing /bro) turned into a permission
 * prompt for a site that does not exist.
 *
 * Matching a prefix is not enough for that: "example.com trailing text" starts
 * like an address and is none, and "http://" carries a scheme and no host. The
 * whole value is parsed instead. With a scheme the user has said what they
 * mean and a host is enough; without one, the dot is what tells "example.com"
 * from "bro".
 */
export function isUsableAddress(url: string): boolean {
  if (/\s/.test(url)) {
    return false;
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
  let host = '';
  try {
    host = new URL(hasScheme ? url : `https://${url}`).hostname;
  } catch {
    return false;
  }

  return host !== '' && (hasScheme || host.includes('.'));
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

    if (url && !isUsableAddress(url)) {
      throw new AppError(`"${url}" is not an address.`, {
        code: 'INVALID_URL',
        statusCode: 400,
      });
    }

    return serialize(() => this.openTabNow(url));
  },

  /** The sequence itself; only ever entered through the queue above. */
  async openTabNow(url: string): Promise<OpenTabResult> {
    // Every call, not just the first: the client drops its connection after any
    // failure and after the idle timeout, so a later call can just as well meet
    // a closed transport. Unwrapped, that reached the route as a plain Error and
    // became a 500, while the button only knows what to say about a 503.
    try {
      // Look before creating. There are two ways a tab comes into being here,
      // and running both is how one click produced two tabs: `createIfEmpty`
      // opens a window with an empty tab when no group exists yet, and
      // `tabs_create_mcp` adds one to a group that does. Which one is needed
      // depends on what is already there, so that is read first - without
      // `createIfEmpty`, so the look itself creates nothing.
      const before = readGroup(await chromeMcpClient.callTool('tabs_context_mcp', {}));
      const known = new Set(before.tabs.map((tab) => tab.tabId));

      let after: { tabGroupId?: number; tabs: Tab[] };
      if (before.tabs.length === 0) {
        // No group, or a group without tabs: this one call is the whole job,
        // and it is what the VS Code extension does for `@browser:newTab`.
        after = readGroup(await chromeMcpClient.callTool('tabs_context_mcp', { createIfEmpty: true }));
      } else {
        // A group with tabs: `createIfEmpty` would have no effect here ("this
        // parameter has no effect" per its schema). The create call does not
        // report the new id, so the context is read again for it.
        await chromeMcpClient.callTool('tabs_create_mcp', {});
        after = readGroup(await chromeMcpClient.callTool('tabs_context_mcp', {}));
      }

      // Only a tab that was not there before. Falling back to the last one in
      // the group looks harmless and is not: when creating a tab fails, that
      // last tab is a page the user has open, and the address below would
      // navigate it away.
      const created = after.tabs.find((tab) => !known.has(tab.tabId));

      const opened: OpenTabResult = {
        tabId: created?.tabId,
        tabGroupId: after.tabGroupId ?? before.tabGroupId,
      };

      if (created?.tabId === undefined) {
        throw new AppError(
          'Chrome did not report a new tab, so nothing was opened.',
          { code: 'NO_TAB_CREATED', statusCode: 502 },
        );
      }

      if (!url) {
        return opened;
      }

      // The tab exists from here on, and the doc comment above promises it is
      // reported either way. A rejection - a dropped transport, the 45 s call
      // timeout - would otherwise reach the outer catch and become a 503, and
      // the caller would never hear about the tab it could have used.
      let navigation: ToolResult;
      try {
        navigation = await chromeMcpClient.callTool('navigate', { url, tabId: created.tabId });
      } catch (error) {
        return {
          ...opened,
          warning: `The tab is open, but the address could not be sent: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }

      if (navigation.isError) {
        const reported = readText(navigation);
        return {
          ...opened,
          warning: /permission/i.test(reported)
            // Only reachable with CLOUDCLI_CHROME_ASK=1; otherwise the client
            // starts the server in skip_all_permission_checks mode.
            ? 'The tab is open. Chrome refused the address - confirm it in the Claude extension, or unset CLOUDCLI_CHROME_ASK.'
            : `The tab is open, but the address was refused: ${reported}`,
        };
      }

      return { ...opened, url };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        error instanceof Error ? error.message : 'Chrome could not be reached.',
        { code: 'CHROME_UNAVAILABLE', statusCode: 503 },
      );
    }
  },

  /** Whether a connection is currently held. */
  getStatus(): { connected: boolean } {
    return { connected: chromeMcpClient.isConnected() };
  },
};
