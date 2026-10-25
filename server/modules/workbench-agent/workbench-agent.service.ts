import path from 'node:path';

import { projectsDb } from '@/modules/database/index.js';
import { buildUsageReport } from '@/modules/usage/index.js';
import { createSession, getSessionView, listSessions } from '@/modules/workbench-sessions/index.js';
import { AppError } from '@/shared/utils.js';
import { agentStore, type AgentToken, type Proposal } from '@/modules/workbench-agent/workbench-agent.store.js';

export const MAX_PROMPT_LENGTH = 4000;
export const MAX_PENDING_PER_TOKEN = 10;
export const MAX_PROPOSALS_PER_DAY = 30;
export const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function notify(message: Record<string, unknown>): void {
  if (typeof process.send === 'function') process.send(message);
}

/** Known repositories (never the per-session worktree projects), by id and display name only. */
export async function feedProjects(): Promise<Array<{ id: string; name: string }>> {
  const worktrees = new Set((await listSessions()).map((session) => session.worktreePath.toLowerCase()));
  return projectsDb
    .getProjectPaths()
    .filter((row) => !worktrees.has(row.project_path.toLowerCase()))
    .map((row) => ({ id: row.project_id, name: row.custom_project_name || path.basename(row.project_path) }));
}

/** Status feed for agents: no prompts, diffs, file contents or full paths. */
export async function feedSessions() {
  return (await listSessions()).map((session) => ({
    id: session.id,
    title: session.title.slice(0, 80),
    project: path.basename(session.projectPath),
    agent: session.agent,
    branch: session.branch,
    baseBranch: session.baseBranch,
    status: session.status,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    dirtyFiles: session.dirtyFiles,
    ahead: session.ahead,
    unpushed: session.unpushed,
  }));
}

/** Daily numbers only, last `days` days. */
export async function feedUsage(days = 30) {
  const report = await buildUsageReport();
  const slim = (bucket: { input: number; output: number; cacheRead: number; cacheCreation: number; total: number }) => ({
    input: bucket.input,
    output: bucket.output,
    total: bucket.total,
    excludingCacheRead: bucket.total - bucket.cacheRead,
  });
  return {
    days: report.days.slice(-Math.max(1, Math.min(days, 365))).map((day) => ({
      date: day.date,
      claude: slim(day.claude),
      codex: slim(day.codex),
      total: slim(day.total),
    })),
    generatedAt: report.generatedAt,
  };
}

export async function createProposal(token: AgentToken, body: Record<string, unknown>): Promise<Proposal> {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) throw new AppError('prompt is required', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new AppError(`prompt is longer than ${MAX_PROMPT_LENGTH} characters`, { code: 'PROMPT_TOO_LONG', statusCode: 400 });
  }
  const agent = body.agent === 'codex' ? 'codex' : body.agent === 'claude' || body.agent === undefined ? 'claude' : null;
  if (!agent) throw new AppError('agent must be "claude" or "codex"', { code: 'INVALID_AGENT', statusCode: 400 });

  const project = (await feedProjects()).find((entry) => entry.id === body.projectId);
  if (!project) throw new AppError('Unknown projectId (see GET /projects)', { code: 'UNKNOWN_PROJECT', statusCode: 404 });

  const baseBranch = typeof body.baseBranch === 'string' && /^[A-Za-z0-9._/-]{1,100}$/.test(body.baseBranch) ? body.baseBranch : null;
  const title = (typeof body.title === 'string' && body.title.trim() ? body.title.trim() : prompt.split('\n')[0]).slice(0, 80);

  if (agentStore.countPending(token.id) >= MAX_PENDING_PER_TOKEN) {
    throw new AppError('Too many proposals are waiting for approval', { code: 'TOO_MANY_PENDING', statusCode: 429 });
  }
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (agentStore.countSince(token.id, dayAgo) >= MAX_PROPOSALS_PER_DAY) {
    throw new AppError('Daily proposal limit reached', { code: 'DAILY_LIMIT', statusCode: 429 });
  }

  const proposal = agentStore.insertProposal({
    tokenId: token.id,
    tokenName: token.name,
    projectId: project.id,
    projectName: project.name,
    agent,
    title,
    prompt,
    baseBranch,
  });
  notify({ type: 'workbench:proposal', proposalId: proposal.id, title: proposal.title, from: token.name });
  return proposal;
}

/** Lazily expires proposals nobody decided within the TTL. */
function withExpiry(proposal: Proposal | null): Proposal | null {
  if (proposal && proposal.status === 'pending' && Date.now() - Date.parse(proposal.createdAt) > PROPOSAL_TTL_MS) {
    agentStore.decide(proposal.id, 'expired', { note: 'No decision within 7 days' });
    return agentStore.getProposal(proposal.id);
  }
  return proposal;
}

export function listProposals(): Proposal[] {
  return agentStore.listProposals().map((proposal) => withExpiry(proposal) as Proposal);
}

export async function proposalForAgent(token: AgentToken, id: string) {
  const proposal = withExpiry(agentStore.getProposal(id));
  if (!proposal || proposal.tokenId !== token.id) {
    throw new AppError('Proposal not found', { code: 'PROPOSAL_NOT_FOUND', statusCode: 404 });
  }
  let sessionStatus: string | null = null;
  if (proposal.sessionId) {
    sessionStatus = await getSessionView(proposal.sessionId).then((session) => session.status).catch(() => 'gone');
  }
  return { id: proposal.id, status: proposal.status, sessionId: proposal.sessionId, sessionStatus, note: proposal.note };
}

export async function approveProposal(id: string, confirm: boolean): Promise<Proposal> {
  if (!confirm) {
    throw new AppError('Approving a proposal starts work on your PC and needs explicit confirmation', {
      code: 'CONFIRMATION_REQUIRED',
      statusCode: 400,
    });
  }
  const proposal = withExpiry(agentStore.getProposal(id));
  if (!proposal) throw new AppError('Proposal not found', { code: 'PROPOSAL_NOT_FOUND', statusCode: 404 });
  if (proposal.status !== 'pending') {
    throw new AppError(`Proposal is already ${proposal.status}`, { code: 'PROPOSAL_NOT_PENDING', statusCode: 409 });
  }
  const projectPath = projectsDb.getProjectPathById(proposal.projectId);
  if (!projectPath) throw new AppError('The project no longer exists', { code: 'UNKNOWN_PROJECT', statusCode: 404 });

  // Decide first so a double click cannot create two sessions; roll back to pending on failure.
  agentStore.decide(proposal.id, 'approved');
  try {
    const session = await createSession({
      projectPath,
      baseBranch: proposal.baseBranch,
      agent: proposal.agent,
      prompt: proposal.prompt,
      title: proposal.title,
    });
    agentStore.decide(proposal.id, 'approved', { sessionId: session.id });
  } catch (error) {
    agentStore.decide(proposal.id, 'pending');
    throw error;
  }
  return agentStore.getProposal(proposal.id) as Proposal;
}

export function rejectProposal(id: string, note: string | null): Proposal {
  const proposal = withExpiry(agentStore.getProposal(id));
  if (!proposal) throw new AppError('Proposal not found', { code: 'PROPOSAL_NOT_FOUND', statusCode: 404 });
  if (proposal.status !== 'pending') {
    throw new AppError(`Proposal is already ${proposal.status}`, { code: 'PROPOSAL_NOT_PENDING', statusCode: 409 });
  }
  agentStore.decide(proposal.id, 'rejected', { note: note?.slice(0, 200) || null });
  return agentStore.getProposal(proposal.id) as Proposal;
}
