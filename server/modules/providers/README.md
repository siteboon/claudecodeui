# Providers Module: How To Add a New Provider

This guide is the canonical checklist for adding a provider to the unified provider system.

The goal is to make provider onboarding deterministic for both humans and AI agents.

## Architecture Summary

Each provider is composed of 3 sub-capabilities behind one wrapper:

- `auth` (`IProviderAuth`): install/auth status
- `mcp` (`IProviderMcp`): MCP server read/write/list for provider-native config files
- `sessions` (`IProviderSessions`): normalize live events and fetch persisted history

Main interfaces:

- `server/shared/interfaces.ts`
- `server/shared/types.ts`
- `server/modules/providers/shared/base/abstract.provider.ts`
- `server/modules/providers/shared/mcp/mcp.provider.ts`

Main registry/services:

- `server/modules/providers/provider.registry.ts`
- `server/modules/providers/services/provider-auth.service.ts`
- `server/modules/providers/services/mcp.service.ts`
- `server/modules/providers/services/sessions.service.ts`

## Files You Must Add

Create `server/modules/providers/list/<provider>/` with:

- `<provider>.provider.ts`
- `<provider>-auth.provider.ts`
- `<provider>-mcp.provider.ts`
- `<provider>-sessions.provider.ts`

Follow the existing structure in `claude`, `codex`, `cursor`, or `gemini`.

## Step-by-Step Checklist

1. Add provider id to shared union types.

- Update `server/shared/types.ts` `LLMProvider`.
- Also update `src/types/app.ts` `LLMProvider` (frontend type).

2. Implement the provider wrapper.

- Extend `AbstractProvider`.
- Expose `readonly auth`, `readonly mcp`, and `readonly sessions`.
- Call `super('<provider>')`.

3. Implement auth provider (`<provider>-auth.provider.ts`).

- Implement `IProviderAuth#getStatus()`.
- Return `{ installed, provider, authenticated, email, method, error? }`.
- Use existing helpers from `server/shared/utils.ts` (`readObjectRecord`, `readOptionalString`, etc.) where relevant.

4. Implement MCP provider (`<provider>-mcp.provider.ts`).

- Extend `McpProvider`.
- Define supported scopes/transports in `super('<provider>', scopes, transports)`.
- Implement:
  - `readScopedServers(...)`
  - `writeScopedServers(...)`
  - `buildServerConfig(...)`
  - `normalizeServerConfig(...)`
- Reuse shared validation behavior in `McpProvider` (scope/transport checks).

5. Implement sessions provider (`<provider>-sessions.provider.ts`).

- Implement `IProviderSessions`:
  - `normalizeMessage(raw, sessionId)`
  - `fetchHistory(sessionId, options)`
- Normalize to `NormalizedMessage` using `createNormalizedMessage(...)`.
- For filesystem-backed sessions, sanitize path inputs (`sessionId`, workspace paths) before reading files/databases.
- Keep pagination semantics consistent:
  - `limit: null` means unbounded
  - `limit: 0` means empty page
  - include `total`, `hasMore`, `offset`, `limit` correctly
- Ensure normalized message ids are unique per output message.

6. Register provider in backend registry/router.

- `server/modules/providers/provider.registry.ts`:
  - import the new provider class
  - add it to the `providers` map
- `server/modules/providers/provider.routes.ts`:
  - update `parseProvider(...)` whitelist

7. Wire runtime execution path (outside this module).

If the provider should run live chat commands, also update runtime routing:

- `server/routes/agent.js` provider validation and dispatch
- `server/index.js` provider routing/command handling/valid provider lists
- Add or wire provider runtime implementation module (similar to `claude-sdk.js`, `cursor-cli.js`, `openai-codex.js`, `gemini-cli.js`)

8. Add model constants and UI integration (outside this module).

- `shared/modelConstants.js` provider model list + default
- Provider selection and state hooks:
  - `src/components/chat/hooks/useChatProviderState.ts`
  - `src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx`
- Auth/login modal command text:
  - `src/components/provider-auth/view/ProviderLoginModal.tsx`

## Minimal Templates

Use these as a starting point.

```ts
// <provider>.provider.ts
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { <Provider>AuthProvider } from './<provider>-auth.provider.js';
import { <Provider>McpProvider } from './<provider>-mcp.provider.js';
import { <Provider>SessionsProvider } from './<provider>-sessions.provider.js';
import type { IProviderAuth, IProviderSessions } from '@/shared/interfaces.js';

export class <Provider>Provider extends AbstractProvider {
  readonly mcp = new <Provider>McpProvider();
  readonly auth: IProviderAuth = new <Provider>AuthProvider();
  readonly sessions: IProviderSessions = new <Provider>SessionsProvider();

  constructor() {
    super('<provider>');
  }
}
```

```ts
// <provider>-sessions.provider.ts
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, readObjectRecord } from '@/shared/utils.js';

const PROVIDER = '<provider>';

export class <Provider>SessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    return [createNormalizedMessage({
      provider: PROVIDER,
      kind: 'text',
      role: 'assistant',
      sessionId,
      content: String(raw.content ?? ''),
    })];
  }

  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const all: NormalizedMessage[] = [];

    if (limit === null) {
      return { messages: all.slice(offset), total: all.length, hasMore: false, offset, limit: null };
    }

    const start = Math.max(0, offset);
    const safeLimit = Math.max(0, limit);
    const page = safeLimit === 0 ? [] : all.slice(start, start + safeLimit);
    return {
      messages: page,
      total: all.length,
      hasMore: safeLimit === 0 ? start < all.length : start + safeLimit < all.length,
      offset: start,
      limit: safeLimit,
    };
  }
}
```

## AI Prompt Template

Use this prompt for AI-assisted implementation:

```text
Add a new provider "<provider>" using the provider module architecture.

Requirements:
1) Create:
   - server/modules/providers/list/<provider>/<provider>.provider.ts
   - server/modules/providers/list/<provider>/<provider>-auth.provider.ts
   - server/modules/providers/list/<provider>/<provider>-mcp.provider.ts
   - server/modules/providers/list/<provider>/<provider>-sessions.provider.ts
2) Register in:
   - server/modules/providers/provider.registry.ts
   - server/modules/providers/provider.routes.ts (parseProvider whitelist)
   - server/shared/types.ts LLMProvider
   - src/types/app.ts LLMProvider
3) Reuse helper utilities and follow existing style from codex/claude/cursor/gemini.
4) Ensure sessions:
   - unique normalized message IDs
   - safe path handling for disk/db session sources
   - correct pagination for limit=null and limit=0
5) Run:
   - npx eslint <touched server files>
   - npx tsc --noEmit -p server/tsconfig.json
```

## Validation Checklist

Run these after implementation:

```bash
npx eslint server/modules/providers/**/*.ts server/shared/types.ts server/shared/interfaces.ts
npx tsc --noEmit -p server/tsconfig.json
```

Quick API smoke tests:

- `GET /api/providers/<provider>/auth/status`
- `GET /api/providers/<provider>/mcp/servers`
- `POST /api/providers/<provider>/mcp/servers`
- `GET /api/sessions/<sessionId>/messages?provider=<provider>&limit=50&offset=0`

## Common Mistakes

- Adding provider files but forgetting `provider.registry.ts`.
- Updating backend `LLMProvider` but not frontend `src/types/app.ts`.
- Hardcoding provider whitelists in routes and missing one location.
- Returning duplicate message ids in `normalizeMessage`.
- Treating `limit === 0` as unbounded instead of empty page.
- Building file paths from raw `sessionId` without validation.
