import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import type { WorkbenchProposal } from '@/shared/types';
import { getErrorText } from '@/shared/utils';
import { Button, Input, LLMProviderLogo } from '@/shared/ui';
import { groupProposals } from '@/modules/workbench-sessions/utils/agentAccessLogic';

type ProposalAction = 'approve' | 'reject';

type PendingProposalCardProps = {
  proposal: WorkbenchProposal;
  onDecided: (proposal: WorkbenchProposal, action: ProposalAction) => Promise<void>;
};

function PendingProposalCard({ proposal, onDecided }: PendingProposalCardProps) {
  const { t, i18n } = useTranslation('workbench');
  // Which decision is waiting for its explicit confirmation step; null shows the two primary buttons.
  const [confirming, setConfirming] = useState<ProposalAction | null>(null);
  // Optional reason sent along with a rejection.
  const [note, setNote] = useState('');
  // True while the approve/reject request runs.
  const [isBusy, setIsBusy] = useState(false);
  // Failure text of the last decision (for example a base branch that no longer exists).
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: ProposalAction) => {
    setIsBusy(true);
    setError(null);
    try {
      const response = action === 'approve'
        ? await api.workbench.approveProposal(proposal.id)
        : await api.workbench.rejectProposal(proposal.id, note.trim());
      const body = await readApiJson<{ data: { proposal: WorkbenchProposal } }>(response);
      await onDecided(body.data.proposal, action);
    } catch (decisionError) {
      setError(getErrorText(decisionError));
      setIsBusy(false);
    }
  };

  const created = new Date(proposal.createdAt).toLocaleString(i18n.language || 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <li className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <LLMProviderLogo provider={proposal.agent} className="h-4 w-4 flex-shrink-0" />
        {/* Text nodes only: titles and prompts come from an AI agent and are never rendered as HTML or markdown. */}
        <h4 className="min-w-0 break-words text-sm font-medium text-foreground">{proposal.title}</h4>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('agentAccess.proposals.meta', {
          token: proposal.tokenName,
          project: proposal.projectName,
          agent: t(`agents.${proposal.agent}`),
        })}
        {proposal.baseBranch ? ` · ${t('agentAccess.proposals.base', { branch: proposal.baseBranch })}` : ''}
        {` · ${created}`}
      </p>

      <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{t('agentAccess.proposals.warning')}</p>
      <pre
        tabIndex={0}
        aria-label={t('agentAccess.proposals.promptLabel')}
        className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/40 p-2 font-mono text-xs text-foreground"
      >
        {proposal.prompt}
      </pre>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {confirming === null && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setConfirming('approve')}>
            {t('agentAccess.proposals.approve')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setConfirming('reject')}>
            {t('agentAccess.proposals.reject')}
          </Button>
        </div>
      )}

      {confirming === 'approve' && (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2">
          <p className="text-xs text-foreground">
            {t('agentAccess.proposals.approveConfirm', { project: proposal.projectName })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="min-h-11 sm:min-h-0" disabled={isBusy} onClick={() => void decide('approve')}>
              {isBusy ? t('common.working') : t('agentAccess.proposals.approveAndStart')}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-0" disabled={isBusy} onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {confirming === 'reject' && (
        <div className="space-y-2 rounded-md border border-border/60 p-2">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('agentAccess.proposals.notePlaceholder')}
            aria-label={t('agentAccess.proposals.notePlaceholder')}
            className="h-11 sm:h-9"
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="destructive" className="min-h-11 sm:min-h-0" disabled={isBusy} onClick={() => void decide('reject')}>
              {isBusy ? t('common.working') : t('agentAccess.proposals.confirmReject')}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-0" disabled={isBusy} onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

type AgentProposalsPanelProps = {
  proposals: WorkbenchProposal[];
  /** Called after a decision succeeded; the dialog reloads its data and, for approvals, selects the new session. */
  onDecided: (proposal: WorkbenchProposal, action: ProposalAction) => Promise<void>;
};

/** Rendered by AgentAccessDialog: the approval queue (pending first, full prompt text for review) and a collapsed history of decided proposals. */
export default function AgentProposalsPanel({ proposals, onDecided }: AgentProposalsPanelProps) {
  const { t } = useTranslation('workbench');
  // Whether the decided-proposals history is expanded; collapsed by default so the queue stays in focus.
  const [showDecided, setShowDecided] = useState(false);
  const { pending, decided } = useMemo(() => groupProposals(proposals), [proposals]);

  return (
    <section aria-labelledby="agent-proposals-heading" className="space-y-3">
      <div>
        <h3 id="agent-proposals-heading" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Inbox className="h-3.5 w-3.5" /> {t('agentAccess.proposals.title')}
          {pending.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[11px] tabular-nums text-primary-foreground">{pending.length}</span>
          )}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('agentAccess.proposals.explain')}</p>
      </div>

      {pending.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('agentAccess.proposals.nonePending')}</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((proposal) => (
            <PendingProposalCard key={proposal.id} proposal={proposal} onDecided={onDecided} />
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDecided((value) => !value)}
            aria-expanded={showDecided}
            className="flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-0"
          >
            {showDecided ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {t('agentAccess.proposals.decided', { count: decided.length })}
          </button>
          {showDecided && (
            <ul className="mt-1 divide-y divide-border/60 rounded-lg border border-border/60">
              {decided.map((proposal) => (
                <li key={proposal.id} className="space-y-0.5 px-3 py-2">
                  <p className="break-words text-sm text-foreground">{proposal.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t(`agentAccess.proposals.status.${proposal.status}`)}
                    {` · ${proposal.tokenName} · ${proposal.projectName}`}
                  </p>
                  {proposal.note && (
                    <p className="break-words text-[11px] text-muted-foreground">{t('agentAccess.proposals.noteLine', { note: proposal.note })}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
