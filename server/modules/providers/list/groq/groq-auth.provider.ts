import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

export class GroqProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    const apiKey = process.env.GROQ_API_KEY?.trim();

    return {
      installed: true,
      provider: 'groq',
      authenticated: Boolean(apiKey),
      email: apiKey ? 'API Key Auth' : null,
      method: apiKey ? 'api_key' : null,
      error: apiKey ? undefined : 'GROQ_API_KEY environment variable is not set',
    };
  }
}
