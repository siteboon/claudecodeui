# Phase 5 Frontend Implementation Notes

## Overview
This document describes the frontend UI adaptations made to integrate ZCode as a new provider in CloudCLI, completing Phase 5 of the ZCode integration plan.

## Implementation Summary

### 1. Chat Provider State (`src/components/chat/hooks/useChatProviderState.ts`)

**Changes Made:**
- Added `'zcode'` to `PROVIDERS` constant array
- Added `zcode: 'GLM-5.3'` to `FALLBACK_DEFAULT_MODEL` record
- Added `zcode: ['default', 'acceptEdits', 'bypassPermissions', 'plan']` to `FALLBACK_PERMISSION_MODES`
- Added `zcodeModel` state with localStorage integration (key: `zcode-model`)
- Updated `setStoredProviderModel` function to handle zcode provider
- Updated `providerModels` useMemo to include zcode
- Added useEffect hook for zcode model catalog management
- Extended return object to include `zcodeModel` and `setZcodeModel`

**Rationale:**
- Follows the same pattern as existing providers (claude, cursor, codex, opencode)
- Enables proper model selection and persistence for ZCode sessions
- Integrates with existing permission mode system

### 2. Empty State Selector (`src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx`)

**Changes Made:**
- Added `{ id: 'zcode', name: 'ZCode' }` to `PROVIDER_META` array
- Added `zcodeModel` and `setZcodeModel` to component props
- Updated `getCurrentModel` function to include zcode parameter
- Updated `getProviderDisplayName` function to return 'ZCode' for zcode provider
- Updated `setModelForProvider` callback to handle zcode
- Added zcode case to readyPrompt translation section

**Rationale:**
- Makes ZCode selectable from the provider dropdown
- Ensures proper model display and selection in UI
- Maintains consistency with existing provider presentation

### 3. Login Modal (`src/components/provider-auth/view/ProviderLoginModal.tsx`)

**Changes Made:**
- Added zcode branch to `getProviderCommand` function returning `'zcode login'`
- Added zcode case to `getProviderTitle` function returning `'ZCode CLI Login'`

**Notes:**
- Installation guidance would be shown through the auth status system
- Login command uses `zcode login` which triggers OAuth flow
- Modal handles both not-installed and not-authenticated states

**Rationale:**
- Provides proper login experience for ZCode users
- Uses ZCode's native login command for authentication

### 4. MCP Constants (`src/components/mcp/constants.ts`)

**Changes Made:**
- Added `zcode: 'ZCode'` to `MCP_PROVIDER_NAMES`
- Added `zcode: ['user', 'project']` to `MCP_SUPPORTED_SCOPES`
- Added `zcode: ['stdio', 'http']` to `MCP_SUPPORTED_TRANSPORTS`
- Added `zcode: 'bg-primary text-primary-foreground hover:bg-primary/90'` to `MCP_PROVIDER_BUTTON_CLASSES`
- Added `zcode: false` to `MCP_SUPPORTS_WORKING_DIRECTORY`

**Config File Path Hints:**
- User scope: `~/.zcode/cli/config.json`
- Project scope: `zcode.json` or `.zcode/config.json`

**Rationale:**
- Enables MCP server configuration for ZCode provider
- Follows ZCode's configuration structure from integration plan
- Matches ZCode's capabilities (no working directory support)

### 5. Provider Effort Constants (`src/components/chat/constants/providerEffort.ts`)

**Changes Made:**
- Added `zcode: ['high', 'low', 'max']` to `FALLBACK_PROVIDER_EFFORT_VALUES`

**Reasoning Variants:**
- Maps to GLM-5.3's reasoning variants
- Default is `max` as specified in the plan
- Ordered as `high`, `low`, `max` to match ZCode's actual variant names

**Rationale:**
- Enables reasoning effort control for ZCode models
- Matches GLM-5.3's native reasoning variant names
- Integrates with existing effort selection UI

### 6. Provider Auth Types (`src/components/provider-auth/types.ts`)

**Changes Made:**
- Added `'zcode'` to `CLI_PROVIDERS` array
- Added `zcode: '/api/providers/zcode/auth/status'` to `PROVIDER_AUTH_STATUS_ENDPOINTS`
- Added zcode entry to `createInitialProviderAuthStatusMap`

**Rationale:**
- Enables authentication status tracking for ZCode
- Integrates with existing auth flow infrastructure

### 7. Settings Constants (`src/components/settings/constants/constants.ts`)

**Changes Made:**
- Added `'zcode'` to `AGENT_PROVIDERS` array

**Rationale:**
- Makes ZCode available in agent settings
- Enables provider-specific configuration

### 8. Provider Skills (`src/components/skills/view/ProviderSkills.tsx`)

**Changes Made:**
- Added `zcode: 'ZCode'` to `PROVIDER_NAMES`
- Added `zcode: '~/.zcode/skills/<skill-name>/SKILL.md'` to `PROVIDER_SKILL_PATHS`
- Updated providerPath logic to exclude zcode (like opencode)

**Rationale:**
- Enables skill management for ZCode provider
- Follows ZCode's skill directory structure
- Maintains consistency with existing providers

## Asset Requirements

### Logo/Icon Assets
**Status:** Required but not yet implemented

**Required Actions:**
1. Add ZCode logo/icon to appropriate assets directory
2. Ensure `SessionProviderLogo` component handles ZCode case
3. Follow existing naming conventions for provider logos

**Suggested Locations:**
- `/src/assets/providers/zcode.png` (or .svg)
- Follow existing provider asset naming pattern

**Component Impact:**
- `SessionProviderLogo` component may need updating to render ZCode logo
- Should support the same icon formats as other providers

## Testing Checklist

### Manual Testing Required
- [ ] Provider selection dropdown shows ZCode option
- [ ] ZCode model selection works correctly
- [ ] Permission mode selection works for ZCode
- [ ] Login modal shows correct ZCode login command
- [ ] MCP configuration panel works for ZCode
- [ ] Reasoning effort selector shows ZCode variants (high/low/max)
- [ ] Skills panel shows ZCode skills correctly
- [ ] Settings include ZCode in agent providers

### Integration Testing
- [ ] Test ZCode selection from empty state
- [ ] Verify model persistence across sessions
- [ ] Test authentication flow with ZCode
- [ ] Verify MCP server configuration saves correctly
- [ ] Test reasoning effort changes apply to sessions

## Technical Notes

### Type Safety
- All changes maintain TypeScript type safety
- `LLMProvider` type should be updated to include `'zcode'`
- No breaking changes to existing provider contracts

### State Management
- ZCode follows the same state management patterns as existing providers
- localStorage integration ensures persistence
- Model catalog integration follows existing patterns

### UI Consistency
- ZCode presentation matches existing providers
- Translation keys follow existing naming conventions
- Component structure maintains consistency

## Known Limitations

1. **Logo Assets:** ZCode logo/icon not yet added - required for full UI completion
2. **Config Paths:** MCP config paths documented but not validated in code
3. **Authentication Flow:** Login command assumes `zcode login` is available in PATH
4. **Error Handling:** ZCode-specific error messages not yet internationalized

## Next Steps

1. **Asset Addition:** Add ZCode logo/icon assets
2. **Component Update:** Update `SessionProviderLogo` if needed
3. **Testing:** Complete manual testing checklist
4. **Internationalization:** Add ZCode-specific translation strings if needed
5. **Documentation:** Update user-facing documentation for ZCode provider

## Files Modified

### High Priority (Core UI Changes)
1. `src/components/chat/hooks/useChatProviderState.ts` - Provider state management
2. `src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx` - Provider selection UI
3. `src/components/provider-auth/view/ProviderLoginModal.tsx` - Login experience

### High Priority (Configuration Support)
4. `src/components/mcp/constants.ts` - MCP configuration
5. `src/components/chat/constants/providerEffort.ts` - Reasoning variants

### Medium Priority (Supporting Infrastructure)
6. `src/components/provider-auth/types.ts` - Auth type definitions
7. `src/components/settings/constants/constants.ts` - Settings integration
8. `src/components/skills/view/ProviderSkills.tsx` - Skills management

## Completion Status

**Phase 5 Status:** ✅ Complete (pending asset addition)

All core frontend UI adaptations have been implemented according to the integration plan. The frontend now supports:
- ZCode provider selection and model management
- Authentication flow integration
- MCP configuration
- Reasoning effort control
- Skills management
- Settings integration

**Remaining Work:**
- Asset addition (logo/icon)
- Manual testing and validation
- Component updates if needed for logo rendering

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-17  
**Implementation Date:** 2026-08-17  
**Status:** Implementation Complete, Testing Pending
