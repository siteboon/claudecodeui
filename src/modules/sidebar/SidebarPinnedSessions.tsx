import type { ComponentProps } from 'react';

import { Button } from '@/shared/ui';
import SidebarRecentConversations from '@/modules/sidebar/SidebarRecentConversations';
import { useSessionPins } from '@/modules/sidebar/hooks/useSessionPins';

/** Rendered by SidebarContent above the session lists in both views: the pinned sessions, or a retryable pin error. */
export default function SidebarPinnedSessions(props: Pick<ComponentProps<typeof SidebarRecentConversations>,
  'selectedSession' | 'currentTime' | 'sessionActions' | 'onConversationSelect' | 't'
>) {
  const pins = useSessionPins();
  if (!pins || (!pins.hasError && pins.sessions.length === 0)) return null;
  return (
    <div className="mb-5" data-testid="pinned-sessions-section">
      {pins.hasError && (
        <div role="alert" className="px-2.5 py-2 text-xs text-muted-foreground">
          <p>{props.t('pinned.error', 'Could not load or save session pins. Please try again.')}</p>
          <Button variant="ghost" size="sm" className="mt-1 h-7 text-xs" onClick={() => void pins.refresh()}>
            {props.t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        </div>
      )}
      {pins.sessions.length > 0 && (
        <SidebarRecentConversations
          {...props}
          listKind="pinned"
          title={props.t('pinned.title', 'Pinned')}
          conversations={pins.sessions}
          total={pins.sessions.length}
          hasMore={false}
          isLoading={false}
          isLoadingMore={false}
          hasError={false}
          onLoadMore={() => {}}
          onRetry={() => void pins.refresh()}
        />
      )}
    </div>
  );
}
