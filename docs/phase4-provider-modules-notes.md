# Phase 4 Provider Modules Implementation Notes

**Date:** 2026-08-17
**Phase:** 4 - Auth/Models/Skills/MCP Provider Implementation
**Status:** ✅ Complete

## Overview

This document captures implementation notes, design decisions, and known considerations for the four ZCode provider modules implemented in Phase 4 of the ZCode integration plan.

## Implemented Modules

### 1. Auth Provider (`zcode-auth.provider.ts`)

**Purpose:** Detect ZCode installation and authentication status without throwing for uninstalled/unauthenticated states.

**Key Implementation Details:**
- Engine path resolution follows priority: `CLOUDCLI_ZCODE_ENGINE` → `which zcode` → platform-specific defaults
- Installation check via `zcode --version` execution with timeout protection
- Authentication detection via credential file at `~/.zcode/cli/credentials.json` (or `ZCODE_DATA_BASE_DIR`)
- OAuth credential parsing for `oauth:zai:access_token` key
- Graceful degradation for missing/unreadable credential files

**Design Decisions:**
- Uses cross-spawn for subprocess execution to ensure Windows compatibility
- Returns version string in method field for diagnostic purposes
- Provides helper methods for install/login guides to be consumed by frontend
- No exceptions thrown for normal "not installed" states per contract

**Known Limitations:**
- Windows paths use `LOCALAPPDATA` environment variable but need Phase 0.2 validation
- Credential file structure assumes OAuth format; may need adjustment for other auth methods
- Email extraction may return null for encrypted credential storage

**Phase 0 Dependencies:**
- **§0.2**: Credential path validation and structure confirmation needed
- **§0.2**: Login command functionality verification required

### 2. Models Provider (`zcode-models.provider.ts`)

**Purpose:** Provide ZCode model catalog from config or builtin fallback, and detect current active model.

**Key Implementation Details:**
- Primary config source: `~/.zcode/v2/config.json` → `provider.*.models`
- Model structure parsing: `reasoning.variants` array, `limit.context/output` values
- Fallback to builtin GLM-5.3 model (1M context, 128K output) when config unavailable
- SQLite query for active model: `message.data.modelID` field from recent message
- Model caching to avoid repeated config reads
- Reasoning variant mapping to frontend effort system

**Design Decisions:**
- Builtin model serves as comprehensive fallback when config read fails
- Model discovery prioritizes config over hardcoded definitions
- Active model detection uses SQLite query rather than protocol calls
- Reasoning variants sorted alphabetically for consistent UI presentation
- Model descriptions auto-generated from context/output limits when not provided

**Known Limitations:**
- Config structure assumed from spike findings; may need Phase 0.3 adjustment
- No protocol-based model discovery implemented (future enhancement)
- SQLite schema assumes `message.data` JSON structure from spike samples
- Model caching may become stale if config changes during runtime

**Phase 0 Dependencies:**
- **§0.3**: Model config structure validation needed
- **§0.3**: SQLite message.data schema confirmation required
- **§0.3**: Reasoning variant format verification needed

### 3. MCP Provider (`zcode-mcp.provider.ts`)

**Purpose:** Read/write ZCode MCP server configuration with proper scope mapping and path security.

**Key Implementation Details:**
- Project scope: `<workspace>/zcode.json` or `<workspace>/.zcode/config.json` (discovery logic)
- User scope: `~/.zcode/cli/config.json`
- Write operations preserve other keys (hooks, etc.) as per §3.2.6 requirements
- Path security validation to prevent directory traversal attacks
- Support for stdio and http transports (SSE excluded per contract)
- Config creation when files don't exist for both scopes

**Design Decisions:**
- Extends shared `McpProvider` base class for consistency
- Config discovery follows ZCode's native precedence (zcode.json → .zcode/config.json)
- Path validation on every write operation to ensure security
- Graceful handling of missing/unreadable config files
- ZCode-native server structure maintained in configuration files

**Known Limitations:**
- Server configuration structure assumed from spike; needs Phase 0.3 validation
- No SSE transport support (contract limitation, not implementation choice)
- Path security may be overly conservative for some edge cases
- Config file locking/concurrency not addressed (potential race condition)

**Phase 0 Dependencies:**
- **§0.3**: MCP server configuration structure validation needed
- **§0.3**: Config file read/write behavior confirmation required

### 4. Skills Provider (`zcode-skills.provider.ts`)

**Purpose:** Discover ZCode skills from project, user, and read-only plugin sources.

**Key Implementation Details:**
- Project scope: `<workspace>/.agents/skills/`
- User scope: `~/.agents/skills/`
- Plugin skills (read-only): `~/.zcode/cli/plugins/cache/*/skills/`
- Plugin metadata from `plugin.json` for name/ID extraction
- Command prefix `/` for all skill types
- Plugin skills use namespaced commands: `/pluginName:skillName`

**Design Decisions:**
- Extends shared `SkillsProvider` base class for consistency
- Plugin skills treated as read-only for v1 (future enhancement point)
- Graceful handling of missing/malformed plugin directories
- Plugin metadata extraction with fallback to directory names
- Skill discovery includes recursive search for nested skill structures

**Known Limitations:**
- Plugin skills read-only limits (intentional for v1, future enhancement)
- Plugin cache structure assumed from spike; needs validation
- No plugin skill write operations implemented (future enhancement)
- Plugin metadata structure may vary across plugin versions
- Recursive skill discovery may encounter performance issues with large plugins

**Phase 0 Dependencies:**
- **§0.1**: Plugin cache directory structure confirmation needed
- **§0.1**: Plugin metadata format validation required
- **§0.1**: Skill discovery behavior verification needed

## Cross-Cutting Concerns

### Error Handling
- All modules use non-throwing error patterns for normal missing/unavailable states
- Filesystem errors caught and handled gracefully with appropriate fallbacks
- Invalid config structures treated as missing rather than causing crashes

### Path Security
- MCP provider implements path traversal prevention per §5.3 requirements
- All path operations use resolution to absolute paths before validation
- Directory traversal checks on every write operation

### Configuration Management
- All config operations preserve existing keys unless explicitly documented
- Config creation when files don't exist (both project and user scopes)
- Graceful degradation when config files are unreadable

### Testing Considerations
- All implementations designed to work without real ZCode installation for unit tests
- Path resolution allows test override via environment variables
- SQLite operations use read-only queries to prevent test pollution

## Integration Points

### Frontend Integration
- **Auth Provider:** Status consumed by `ProviderLoginModal` for login guidance
- **Models Provider:** Model options consumed by model pickers and selection UI
- **MCP Provider:** Server lists consumed by MCP management interface
- **Skills Provider:** Skill lists consumed by skill browser and command completion

### Backend Integration
- **Provider Registry:** All four modules registered with `ZCodeProvider` main class
- **Database:** Models provider uses `sessionsDb` for active model queries
- **Shared Utils:** All modules leverage shared utilities for config parsing and validation

## Future Enhancements

### Phase 5+ Considerations
1. **Auth Provider:** Windows path validation and credential format expansion
2. **Models Provider:** Protocol-based model discovery, cache invalidation
3. **MCP Provider:** SSE transport support, config locking mechanisms
4. **Skills Provider:** Plugin skill write operations, enhanced metadata extraction

### Protocol Integration
- Runtime provider will use these modules for session initialization
- Session synchronizer will interact with models provider for model detection
- Skills provider will support runtime skill execution and permission handling

## Compliance with Backend Module Standards

✅ **TypeScript Strict Mode:** All modules implemented in TypeScript with strict types
✅ **Barrel Exports:** Main provider class will export only required public API
✅ **Shared Types:** All type definitions use shared interfaces from `@/shared`
✅ **Error Handling:** Proper error handling without exceptions for normal states
✅ **Path Security:** All path operations include security validation
✅ **Documentation:** Comprehensive inline comments explaining design decisions

## Dependencies on Phase 0 Validation

The following validation gates from Phase 0 are critical for final implementation:

| Section | Validation Item | Impact if Unvalidated |
|---------|-----------------|---------------------|
| §0.2 | Credential file structure and path | Auth provider may misread credentials |
| §0.2 | Login command functionality | User guidance may be incorrect |
| §0.3 | Model config structure | Models provider may fail to parse models |
| §0.3 | SQLite message schema | Active model detection may fail |
| §0.3 | MCP server config format | MCP provider may mishandle server definitions |
| §0.1 | Plugin cache structure | Skills provider may miss plugin skills |

## Conclusion

All four provider modules have been successfully implemented following the integration plan specifications and backend module standards. The implementations are designed to work with current understanding of ZCode's configuration and data structures, with clear dependencies on Phase 0 validation for final refinement.

The modules provide a solid foundation for Phase 5 (runtime implementation) and subsequent integration phases, with proper error handling, security considerations, and extensibility for future enhancements.

**Next Steps:**
1. Complete Phase 0 validation gates to confirm config structures and paths
2. Implement remaining provider modules (runtime, sessions, session-synchronizer)
3. Update provider registry and frontend integration
4. End-to-end testing with real ZCode installation