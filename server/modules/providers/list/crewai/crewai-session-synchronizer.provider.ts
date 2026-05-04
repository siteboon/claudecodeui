import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type CrewRunRecord = {
  id: string;
  crew_name?: string;
  status: string;
  result?: string;
  started_at?: string;
  completed_at?: string;
};

export class CrewAISessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'crewai' as const;
  private readonly bridgeUrl: string;

  constructor(bridgeUrl?: string) {
    this.bridgeUrl = bridgeUrl ?? (process.env.CREWAI_BRIDGE_URL || 'http://localhost:8000');
  }

  async synchronize(since?: Date): Promise<number> {
    let url = `${this.bridgeUrl}/crew/runs`;
    if (since) {
      url += `?since=${since.toISOString()}`;
    }

    let runs: CrewRunRecord[];
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return 0;
      runs = (await resp.json()) as CrewRunRecord[];
    } catch {
      return 0;
    }

    let processed = 0;
    for (const run of runs) {
      if (!run.id) continue;

      sessionsDb.createSession(
        run.id,
        this.provider,
        'crewai://crew-run',
        run.crew_name ?? 'Untitled Crew Run',
        run.started_at,
        run.completed_at ?? run.started_at,
      );
      processed += 1;
    }

    return processed;
  }

  async synchronizeFile(_filePath: string): Promise<string | null> {
    return null;
  }
}
