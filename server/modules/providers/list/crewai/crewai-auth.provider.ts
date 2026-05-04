import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

export class CrewAIProviderAuth implements IProviderAuth {
  private async checkBridgeHealth(): Promise<boolean> {
    const bridgeUrl = process.env.CREWAI_BRIDGE_URL || 'http://localhost:8000';
    try {
      const response = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkBridgeHealth();

    return {
      installed,
      provider: 'crewai',
      authenticated: installed,
      email: null,
      method: installed ? 'bridge' : null,
      error: installed ? undefined : 'CrewAI FastAPI bridge is not running. Start it with: python bridge/api.py',
    };
  }
}
