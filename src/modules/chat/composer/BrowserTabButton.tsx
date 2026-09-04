import { useCallback, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';

import { authenticatedFetch } from '@/shared/api';
import { PromptInputButton } from '@/modules/chat/composer/PromptInput';

/**
 * Opens a tab in the Chrome the user already has running.
 *
 * Deliberately not a message to the agent. Asked as a prompt, every tool call
 * is a model turn, and the wait is dominated by thinking rather than by the
 * browser - the browser side of it measures about 200 ms once the connection
 * is held. This button posts straight to the server, the same shape the VS
 * Code extension uses for `@browser:newTab`: a ui message, no model.
 */

type OpenTabResult = {
  tabId?: number;
  url?: string;
  warning?: string;
};

export default function BrowserTabButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openTab = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch('/api/chrome-tabs/tab', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.error || 'Chrome could not be reached.');
      }

      const data = (payload.data ?? {}) as OpenTabResult;
      if (data.warning) {
        setMessage(data.warning);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      // The note is a hint, not a state to clear by hand.
      setTimeout(() => setMessage(null), 6000);
    }
  }, []);

  return (
    <span className="relative inline-flex">
      {message && (
        <span className="absolute bottom-full left-1/2 mb-1 max-w-72 -translate-x-1/2 rounded bg-red-600 px-2 py-1 text-xs text-white shadow-lg">
          {message}
        </span>
      )}
      <PromptInputButton
        tooltip={{ content: 'New tab in Chrome' }}
        aria-label="New tab in Chrome"
        onClick={(event: { preventDefault: () => void }) => {
          event.preventDefault();
          void openTab();
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Globe />}
      </PromptInputButton>
    </span>
  );
}
