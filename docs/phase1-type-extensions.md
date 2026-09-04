# Phase 1: Type Extensions - Files Requiring `zcode` Branches

**Date:** 2026-08-17  
**Status:** Type extensions completed, ready for branch additions

## Summary

After extending the `LLMProvider` type in both `server/shared/types.ts` and `src/types/app.ts` to include `'zcode'`, the following files require `zcode` branches to be added to complete Phase 1 implementation.

## Backend Files (4 files)

### 1. `server/modules/providers/provider.registry.ts`
**Location:** Line 9-14  
**Change Required:** Add `zcode: new ZCodeProvider()` to the `providers` Record  
```typescript
const providers: Record<LLMProvider, IProvider> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  cursor: new CursorProvider(),
  opencode: new OpenCodeProvider(),
  zcode: new ZCodeProvider(), // ADD THIS
};
```

### 2. `server/modules/providers/provider.routes.ts`
**Location:** Lines 283-298 (parseProvider function)  
**Change Required:** Add `|| normalized === 'zcode'` to validation  
```typescript
const parseProvider = (value: unknown): LLMProvider => {
  const normalized = normalizeProviderParam(value);
  if (
    normalized === 'claude'
    || normalized === 'codex'
    || normalized === 'cursor'
    || normalized === 'opencode'
    || normalized === 'zcode' // ADD THIS
  ) {
    return normalized;
  }
  // ... error handling
};
```

### 3. `server/modules/providers/services/provider-capabilities.service.ts`
**Location:** Lines 36-84 (PROVIDER_CAPABILITIES Record)  
**Change Required:** Add zcode capabilities object based on integration plan §5
```typescript
const PROVIDER_CAPABILITIES: Record<LLMProvider, ProviderCapabilities> = {
  // ... existing providers
  zcode: {
    provider: 'zcode',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'],
    defaultPermissionMode: 'default',
    supportsImages: true, // Phase 0.3 confirmation needed
    supportsFiles: true,  // Phase 0.3 confirmation needed
    supportsAbort: true,
    supportsPermissionRequests: false, // Phase 0.3 confirmation needed
    supportsTokenUsage: true,
    supportsEffort: true, // GLM-5.3 reasoning variants
  },
};
```

### 4. `server/modules/agent/agent.routes.ts`
**Location:** Line 665 (JSDoc comment)  
**Change Required:** Update JSDoc provider enumeration  
```typescript
* @param {string} provider - (Optional) AI provider to use. Options: 'claude' | 'cursor' | 'codex' | 'opencode' | 'zcode'
```

## Frontend Files (7 files)

### 5. `src/components/provider-auth/types.ts`
**Location:** Lines 13, 15-20, 22-27  
**Changes Required:** 
- Add `'zcode'` to `CLI_PROVIDERS` array
- Add zcode endpoint to `PROVIDER_AUTH_STATUS_ENDPOINTS` Record
- Add zcode status to `createInitialProviderAuthStatusMap`

```typescript
export const CLI_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode', 'zcode'];

export const PROVIDER_AUTH_STATUS_ENDPOINTS: Record<LLMProvider, string> = {
  // ... existing providers
  zcode: '/api/providers/zcode/auth/status',
};

export const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
  // ... existing providers
  zcode: { authenticated: false, email: null, method: null, error: null, loading },
});
```

### 6. `src/components/settings/constants/constants.ts`
**Location:** `AGENT_PROVIDERS` array  
**Change Required:** Add `'zcode'` to the agent providers list  
```typescript
export const AGENT_PROVIDERS: AgentProvider[] = ['claude', 'cursor', 'codex', 'opencode', 'zcode'];
```

### 7. `src/components/chat/hooks/useChatProviderState.ts`
**Location:** Lines 20-25 (FALLBACK_DEFAULT_MODEL), Line 27 (PROVIDERS), Lines 42-47 (FALLBACK_PERMISSION_MODES), and localStorage keys throughout  
**Changes Required:** 
- Add zcode default model: `zcode: 'GLM-5.3'`
- Add `'zcode'` to PROVIDERS array
- Add zcode permission modes: `zcode: ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto']`
- Add localStorage handling for `'zcode-model'`

```typescript
const FALLBACK_DEFAULT_MODEL: Record<LLMProvider, string> = {
  claude: 'default',
  cursor: 'gpt-5.3-codex',
  codex: 'gpt-5.4',
  opencode: 'anthropic/claude-sonnet-4-5',
  zcode: 'GLM-5.3', // ADD THIS
};

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode', 'zcode'];

const FALLBACK_PERMISSION_MODES: Record<LLMProvider, PermissionMode[]> = {
  // ... existing providers
  zcode: ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'],
};
```

### 8. `src/components/mcp/constants.ts`
**Location:** Lines 3-8 (MCP_PROVIDER_NAMES), Lines 10-15 (MCP_SUPPORTED_SCOPES), Lines 17-22 (MCP_SUPPORTED_TRANSPORTS), Lines 28-33 (MCP_PROVIDER_BUTTON_CLASSES)  
**Changes Required:** Add zcode entries to all MCP-related Records
```typescript
export const MCP_PROVIDER_NAMES: Record<McpProvider, string> = {
  // ... existing providers
  zcode: 'ZCode',
};

export const MCP_SUPPORTED_SCOPES: Record<McpProvider, McpScope[]> = {
  // ... existing providers  
  zcode: ['user', 'project'], // Phase 0 confirmation needed
};

export const MCP_SUPPORTED_TRANSPORTS: Record<McpProvider, McpTransport[]> = {
  // ... existing providers
  zcode: ['stdio', 'http'], // Phase 0 confirmation needed
};
```

### 9. `src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx`
**Location:** Lines 32-37 (PROVIDER_META)  
**Change Required:** Add zcode to provider metadata  
```typescript
const PROVIDER_META: { id: LLMProvider; name: string }[] = [
  { id: 'claude', name: 'Anthropic' },
  { id: 'codex', name: 'OpenAI' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'zcode', name: 'ZCode' }, // ADD THIS
];
```

### 10. `src/components/skills/view/ProviderSkills.tsx`
**Location:** Lines 58-63 (PROVIDER_NAMES), Lines 65-69 (PROVIDER_SKILL_PATHS)  
**Changes Required:** Add zcode entries (skill paths follow standard pattern)
```typescript
const PROVIDER_NAMES: Record<SkillsProvider, string> = {
  // ... existing providers
  zcode: 'ZCode',
};

const PROVIDER_SKILL_PATHS: Record<Exclude<SkillsProvider, 'opencode'>, string> = {
  claude: '~/.claude/skills/<skill-name>/SKILL.md',
  codex: '~/.agents/skills/<skill-name>/SKILL.md',
  cursor: '~/.cursor/skills/<skill-name>/SKILL.md',
  zcode: '~/.agents/skills/<skill-name>/SKILL.md', // ADD THIS
};
```

### 11. `src/components/chat/constants/providerEffort.ts`
**Location:** Lines 5-12 (FALLBACK_PROVIDER_EFFORT_VALUES)  
**Change Required:** Add zcode reasoning variants  
```typescript
export const FALLBACK_PROVIDER_EFFORT_VALUES: Partial<Record<LLMProvider, readonly string[]>> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  opencode: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  zcode: ['low', 'high', 'max'], // GLM-5.3 reasoning variants
};
```

## Implementation Notes

1. **Backend Priority:** Files 1-3 are critical path for Phase 2 protocol client implementation
2. **Frontend Priority:** Files 5-9 needed for UI integration (Phase 5)
3. **Configuration Dependencies:** Some capabilities (image support, file support, permission requests, MCP transports) require Phase 0.3 verification
4. **Type Safety:** All changes maintain TypeScript strict mode compliance
5. **Consistent Pattern:** All Records follow the existing `Record<LLMProvider, T>` pattern

## Next Steps

1. Complete Phase 1 by adding `zcode` branches to all 11 files listed above
2. Run full TypeScript compilation check: `npx tsc --noEmit`
3. Proceed to Phase 2: Protocol Client Implementation

**Total Files Requiring Updates: 11 files (4 backend + 7 frontend)**