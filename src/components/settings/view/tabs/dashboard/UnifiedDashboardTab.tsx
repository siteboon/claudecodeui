import { useEffect, useState } from 'react';

import CrewAISummary from '../../../../crewai/CrewAISummary';
import type { CrewAIAgentStatus } from '../../../../crewai/types';

interface CrewAIStatus {
  activeRunIds: string[];
  agents: CrewAIAgentStatus[];
  crewName: string;
}

interface NineRouterHealth {
  reachable: boolean;
  port?: number;
}

interface NineRouterAccount {
  id: string;
  provider: string;
  name: string;
  active: boolean;
}

interface NineRouterUsage {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
}

interface NineRouterData {
  health: NineRouterHealth;
  accounts: NineRouterAccount[];
  usage: NineRouterUsage;
}

interface OpenClaudeSession {
  id: string;
  projectName: string;
  messageCount: number;
  lastModified: string;
}

export default function UnifiedDashboardTab() {
  const [routerData, setRouterData] = useState<NineRouterData | null>(null);
  const [ocSessions, setOcSessions] = useState<OpenClaudeSession[]>([]);
  const [crewaiStatus, setCrewaiStatus] = useState<CrewAIStatus | null>(null);

  useEffect(() => {
    fetch('/api/9router/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setRouterData(data); })
      .catch(() => {});

    fetch('/api/openclaude/sessions')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.sessions) setOcSessions(data.sessions); })
      .catch(() => {});

    fetch('/api/crewai/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setCrewaiStatus(data); })
      .catch(() => {});
  }, []);

  const isRouterConnected = routerData?.health?.reachable === true;

  return (
    <div className="space-y-6">
      {/* 9Router Section */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">9Router Gateway</h3>
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${isRouterConnected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-sm font-medium">
              {isRouterConnected
                ? `Connected :${routerData?.health?.port ?? 20128}`
                : 'Not connected'}
            </span>
          </div>

          {isRouterConnected && routerData && (
            <>
              <div className="mb-3 grid grid-cols-3 gap-3">
                <div className="rounded-md border border-border bg-background p-3 text-center">
                  <div className="text-lg font-bold">{routerData.accounts.length}</div>
                  <div className="text-xs text-muted-foreground">Accounts</div>
                </div>
                <div className="rounded-md border border-border bg-background p-3 text-center">
                  <div className="text-lg font-bold">{routerData.usage.totalRequests}</div>
                  <div className="text-xs text-muted-foreground">Requests</div>
                </div>
                <div className="rounded-md border border-border bg-background p-3 text-center">
                  <div className="text-lg font-bold">${routerData.usage.totalCostUsd.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">Cost (24h)</div>
                </div>
              </div>

              {routerData.accounts.length > 0 && (
                <div className="space-y-1">
                  {routerData.accounts.map((account) => (
                    <div key={account.id} className="flex items-center gap-2 text-xs">
                      <span className={`h-1.5 w-1.5 rounded-full ${account.active ? 'bg-green-500' : 'bg-gray-400'}`} />
                      <span className="font-medium">{account.name}</span>
                      <span className="text-muted-foreground">{account.provider}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* OpenClaude Section */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">OpenClaude Sessions</h3>
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          {ocSessions.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">No sessions found</p>
          ) : (
            <div className="space-y-2">
              {ocSessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between rounded-md border border-border bg-background p-3">
                  <div>
                    <div className="text-sm font-medium">{session.projectName}</div>
                    <div className="text-xs text-muted-foreground">
                      {session.messageCount} messages
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(session.lastModified).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CrewAI Section */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">CrewAI Agents</h3>
        {crewaiStatus?.agents && crewaiStatus.agents.length > 0 ? (
          <CrewAISummary agents={crewaiStatus.agents} crewName={crewaiStatus.crewName} />
        ) : (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-center text-sm text-muted-foreground">
              No active crews. Start a crew from the chat interface.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
