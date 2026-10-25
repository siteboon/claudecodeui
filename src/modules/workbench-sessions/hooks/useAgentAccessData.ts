import { useCallback, useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { WorkbenchAgentToken, WorkbenchProposal } from '@/shared/types';
import { getErrorText } from '@/shared/utils';

type AgentAccessData = {
  tokens: WorkbenchAgentToken[];
  proposals: WorkbenchProposal[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/** Loads the agent access tokens and proposals while the dialog is mounted, and again on `reload()`. */
export function useAgentAccessData(): AgentAccessData {
  // Tokens known to the server; the plaintext is never in these records.
  const [tokens, setTokens] = useState<WorkbenchAgentToken[]>([]);
  // Proposals from every agent token, in server order; the panel groups and sorts them.
  const [proposals, setProposals] = useState<WorkbenchProposal[]>([]);
  // True until the first load finishes, so the dialog can say "loading" instead of "none yet".
  const [isLoading, setIsLoading] = useState(true);
  // Message of the last failed load, cleared by the next success.
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [tokenBody, proposalBody] = await Promise.all([
        readApiJson<{ data: { tokens: WorkbenchAgentToken[] } }>(await api.workbench.agentTokens()),
        readApiJson<{ data: { proposals: WorkbenchProposal[] } }>(await api.workbench.agentProposals()),
      ]);
      setTokens(tokenBody.data.tokens);
      setProposals(proposalBody.data.proposals);
      setError(null);
    } catch (loadError) {
      setError(getErrorText(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on open, then keep following new proposals while the dialog stays open.
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 10_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  return { tokens, proposals, isLoading, error, reload };
}
