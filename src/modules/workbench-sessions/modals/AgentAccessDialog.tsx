import { useTranslation } from 'react-i18next';

import type { WorkbenchProposal } from '@/shared/types';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import AgentProposalsPanel from '@/modules/workbench-sessions/AgentProposalsPanel';
import AgentTokensPanel from '@/modules/workbench-sessions/AgentTokensPanel';
import { useWorkbenchSessions } from '@/modules/workbench-sessions/context/WorkbenchSessionsContext';
import { useAgentAccessData } from '@/modules/workbench-sessions/hooks/useAgentAccessData';

/** Body of the dialog; mounted only while it is open so tokens and proposals load on demand. */
function AgentAccessBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('workbench');
  const { selectSession, refresh, refreshProposals } = useWorkbenchSessions();
  const { tokens, proposals, isLoading, error, reload } = useAgentAccessData();

  const handleChanged = async () => {
    await Promise.all([reload(), refreshProposals()]);
  };

  const handleDecided = async (proposal: WorkbenchProposal, action: 'approve' | 'reject') => {
    await handleChanged();
    if (action === 'approve' && proposal.sessionId) {
      // The new session exists on the server now; selecting it starts its terminal.
      await refresh();
      selectSession(proposal.sessionId);
      onClose();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t('agentAccess.title')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('agentAccess.description')}</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t('agentAccess.loading')}</p>}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t('agentAccess.loadFailed', { message: error })}
        </p>
      )}

      {!isLoading && (
        <>
          <AgentProposalsPanel proposals={proposals} onDecided={handleDecided} />
          <AgentTokensPanel tokens={tokens} onChanged={handleChanged} />
        </>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </div>
  );
}

/** Rendered by WorkbenchSessionsSection: owner-side management of agent tokens and the queue of task proposals agents submitted. */
export default function AgentAccessDialog() {
  const { t } = useTranslation('workbench');
  const { isAgentAccessOpen, setAgentAccessOpen } = useWorkbenchSessions();

  return (
    <Dialog open={isAgentAccessOpen} onOpenChange={setAgentAccessOpen}>
      <DialogContent
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5"
        aria-describedby="agent-access-description"
      >
        <DialogTitle className="sr-only">{t('agentAccess.title')}</DialogTitle>
        <span id="agent-access-description" className="sr-only">{t('agentAccess.description')}</span>
        {isAgentAccessOpen && <AgentAccessBody onClose={() => setAgentAccessOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
