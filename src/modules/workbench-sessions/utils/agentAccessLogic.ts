import type { WorkbenchAgentToken, WorkbenchProposal } from '@/shared/types';

/** Proposals split for the dialog: the queue that needs a decision, and the history below it. */
type ProposalGroups = {
  pending: WorkbenchProposal[];
  decided: WorkbenchProposal[];
};

/**
 * Groups proposals for display. Pending ones come first, oldest first (the one waiting longest is
 * the most urgent); decided and expired ones follow, newest decision first.
 */
export function groupProposals(proposals: WorkbenchProposal[]): ProposalGroups {
  const pending = proposals
    .filter((proposal) => proposal.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const decided = proposals
    .filter((proposal) => proposal.status !== 'pending')
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));
  return { pending, decided };
}

/** Number shown on the sidebar badge; counts from the list so it never disagrees with what the dialog shows. */
export function countPendingProposals(proposals: WorkbenchProposal[]): number {
  return proposals.reduce((count, proposal) => (proposal.status === 'pending' ? count + 1 : count), 0);
}

/** Badge text: nothing for zero, the number up to 9, then "9+" so the badge stays small. */
export function formatPendingBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/** Active tokens first (newest first), revoked ones last. */
export function sortTokens(tokens: WorkbenchAgentToken[]): WorkbenchAgentToken[] {
  return [...tokens].sort((a, b) => {
    if (a.revoked !== b.revoked) return a.revoked ? 1 : -1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * Masks a token for display after it was created: only the prefix and the last four characters
 * remain, so two tokens can be told apart without exposing the secret. Short values are fully masked.
 */
export function maskToken(token: string): string {
  if (token.length <= 12) return '•'.repeat(Math.max(token.length, 6));
  return `${token.slice(0, 4)}${'•'.repeat(8)}${token.slice(-4)}`;
}
