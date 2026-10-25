import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { getConnection } from '@/modules/database/index.js';

export type AgentToken = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
};

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type Proposal = {
  id: string;
  tokenId: string;
  tokenName: string;
  projectId: string;
  projectName: string;
  agent: 'claude' | 'codex';
  title: string;
  prompt: string;
  baseBranch: string | null;
  status: ProposalStatus;
  createdAt: string;
  decidedAt: string | null;
  sessionId: string | null;
  note: string | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workbench_agent_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workbench_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  token_id TEXT NOT NULL,
  token_name TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  agent TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  base_branch TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  session_id TEXT,
  note TEXT
);
`;

let ready = false;
function db() {
  const connection = getConnection();
  if (!ready) {
    connection.exec(SCHEMA);
    ready = true;
  }
  return connection;
}

export function resetAgentStoreForTests(): void {
  ready = false;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type TokenRow = { id: string; name: string; created_at: string; last_used_at: string | null; revoked: number };
const toToken = (row: TokenRow): AgentToken => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revoked: row.revoked === 1,
});

type ProposalRow = {
  id: string; token_id: string; token_name: string; project_id: string; project_name: string; agent: string;
  title: string; prompt: string; base_branch: string | null; status: string; created_at: string;
  decided_at: string | null; session_id: string | null; note: string | null;
};
const toProposal = (row: ProposalRow): Proposal => ({
  id: row.id,
  tokenId: row.token_id,
  tokenName: row.token_name,
  projectId: row.project_id,
  projectName: row.project_name,
  agent: row.agent === 'codex' ? 'codex' : 'claude',
  title: row.title,
  prompt: row.prompt,
  baseBranch: row.base_branch,
  status: row.status as ProposalStatus,
  createdAt: row.created_at,
  decidedAt: row.decided_at,
  sessionId: row.session_id,
  note: row.note,
});

export const agentStore = {
  /** Creates a token. The plaintext is returned once and only its SHA-256 is stored. */
  createToken(name: string): { token: string; record: AgentToken } {
    const token = `wbk_${randomBytes(32).toString('base64url')}`;
    const id = randomUUID();
    db()
      .prepare('INSERT INTO workbench_agent_tokens (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, hashToken(token), new Date().toISOString());
    return { token, record: this.getToken(id) as AgentToken };
  },

  getToken(id: string): AgentToken | null {
    const row = db().prepare('SELECT * FROM workbench_agent_tokens WHERE id = ?').get(id) as TokenRow | undefined;
    return row ? toToken(row) : null;
  },

  listTokens(): AgentToken[] {
    return (db().prepare('SELECT * FROM workbench_agent_tokens ORDER BY created_at DESC').all() as TokenRow[]).map(toToken);
  },

  revokeToken(id: string): boolean {
    return db().prepare('UPDATE workbench_agent_tokens SET revoked = 1 WHERE id = ?').run(id).changes > 0;
  },

  /** Verifies a presented token against stored hashes (constant-time compare). */
  verifyToken(presented: string): AgentToken | null {
    if (!presented.startsWith('wbk_') || presented.length > 200) return null;
    const hash = Buffer.from(hashToken(presented), 'hex');
    const row = db()
      .prepare('SELECT * FROM workbench_agent_tokens WHERE token_hash = ? AND revoked = 0')
      .get(hashToken(presented)) as (TokenRow & { token_hash: string }) | undefined;
    if (!row || !timingSafeEqual(hash, Buffer.from(row.token_hash, 'hex'))) return null;
    db().prepare('UPDATE workbench_agent_tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    return toToken(row);
  },

  insertProposal(input: Omit<Proposal, 'id' | 'status' | 'createdAt' | 'decidedAt' | 'sessionId' | 'note'>): Proposal {
    const id = randomUUID();
    db()
      .prepare(
        `INSERT INTO workbench_proposals
          (id, token_id, token_name, project_id, project_name, agent, title, prompt, base_branch, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, input.tokenId, input.tokenName, input.projectId, input.projectName, input.agent, input.title, input.prompt, input.baseBranch, new Date().toISOString());
    return this.getProposal(id) as Proposal;
  },

  getProposal(id: string): Proposal | null {
    const row = db().prepare('SELECT * FROM workbench_proposals WHERE id = ?').get(id) as ProposalRow | undefined;
    return row ? toProposal(row) : null;
  },

  listProposals(limit = 100): Proposal[] {
    return (db().prepare('SELECT * FROM workbench_proposals ORDER BY created_at DESC LIMIT ?').all(limit) as ProposalRow[]).map(toProposal);
  },

  countPending(tokenId?: string): number {
    const row = tokenId
      ? db().prepare("SELECT COUNT(*) AS n FROM workbench_proposals WHERE status = 'pending' AND token_id = ?").get(tokenId)
      : db().prepare("SELECT COUNT(*) AS n FROM workbench_proposals WHERE status = 'pending'").get();
    return (row as { n: number }).n;
  },

  countSince(tokenId: string, sinceIso: string): number {
    const row = db()
      .prepare('SELECT COUNT(*) AS n FROM workbench_proposals WHERE token_id = ? AND created_at >= ?')
      .get(tokenId, sinceIso) as { n: number };
    return row.n;
  },

  decide(id: string, status: ProposalStatus, extra: { sessionId?: string | null; note?: string | null } = {}): void {
    db()
      .prepare('UPDATE workbench_proposals SET status = ?, decided_at = ?, session_id = ?, note = ? WHERE id = ?')
      .run(status, new Date().toISOString(), extra.sessionId ?? null, extra.note ?? null, id);
  },
};
