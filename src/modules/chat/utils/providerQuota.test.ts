import { describe, expect, it } from 'vitest';

import {
  buildProviderQuotaUrl,
  resolveIsActiveQuotaGroup,
  resolveQuotaProvider,
} from '@/modules/chat/utils/providerQuota';

describe('providerQuota', () => {
  it('resolveQuotaProvider enables only providers with account quota adapters', () => {
    expect(resolveQuotaProvider('antigravity')).toBe('antigravity');
    expect(resolveQuotaProvider('codex')).toBe('codex');
    expect(resolveQuotaProvider('zcode')).toBe('zcode');
    expect(resolveQuotaProvider('claude')).toBeNull();
    expect(resolveQuotaProvider(undefined)).toBeNull();
  });

  it('buildProviderQuotaUrl addresses the active provider and optional refresh', () => {
    expect(buildProviderQuotaUrl('codex')).toBe('/api/providers/quota?provider=codex');
    expect(buildProviderQuotaUrl('antigravity', true)).toBe(
      '/api/providers/quota?provider=antigravity&refresh=true',
    );
  });

  it('resolveIsActiveQuotaGroup identifies active session group accurately', () => {
    const zcodeGroup = { name: 'ZCode (TIER_1)', description: 'BigModel Coding Plan account quota' };
    expect(resolveIsActiveQuotaGroup('glm-5.3', zcodeGroup, 1)).toBe(true);
    expect(resolveIsActiveQuotaGroup('glm-4.5', zcodeGroup, 1)).toBe(true);

    const codexGroup = { name: 'Codex (PLUS)', description: 'Codex account-level rate limits' };
    expect(resolveIsActiveQuotaGroup('gpt-5.4', codexGroup, 1)).toBe(true);

    const geminiGroup = { name: 'Gemini Models', description: 'Gemini Flash, Gemini Pro' };
    const claudeGroup = { name: 'Claude models', description: 'Claude Opus, Sonnet' };
    const gptGroup = { name: 'GPT models', description: 'GPT-OSS, GPT-4o' };
    const claudeGptGroup = { name: 'Claude and GPT models', description: 'Claude Opus, GPT-OSS' };

    expect(resolveIsActiveQuotaGroup('gemini-3.7-flash', geminiGroup, 2)).toBe(true);
    expect(resolveIsActiveQuotaGroup('gemini-3.7-flash', claudeGptGroup, 2)).toBe(false);

    expect(resolveIsActiveQuotaGroup('claude-3-7-sonnet', claudeGptGroup, 2)).toBe(true);
    expect(resolveIsActiveQuotaGroup('claude-3-7-sonnet', claudeGroup, 2)).toBe(true);
    expect(resolveIsActiveQuotaGroup('claude-3-7-sonnet', gptGroup, 2)).toBe(false);
    expect(resolveIsActiveQuotaGroup('claude-3-7-sonnet', geminiGroup, 2)).toBe(false);

    expect(resolveIsActiveQuotaGroup('gpt-5.3-codex', claudeGptGroup, 2)).toBe(true);
    expect(resolveIsActiveQuotaGroup('gpt-5.3-codex', gptGroup, 2)).toBe(true);
    expect(resolveIsActiveQuotaGroup('gpt-5.3-codex', claudeGroup, 2)).toBe(false);
    expect(resolveIsActiveQuotaGroup('gpt-5.3-codex', geminiGroup, 2)).toBe(false);
  });
});
