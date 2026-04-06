# LLM Module Structure (Refactor Runtime)

This document describes the current backend structure under `server/src/modules/llm`, how execution/session state works, and how the provider abstraction is designed.

## High-Level Layout

```text
server/src/modules/llm/
  llm.routes.ts
  llm.registry.ts
  providers/
    provider.interface.ts
    abstract.provider.ts
    base-sdk.provider.ts
    base-cli.provider.ts
    claude.provider.ts
    codex.provider.ts
    cursor.provider.ts
    gemini.provider.ts
  services/
    llm.service.ts
    sessions.service.ts
    sessions-watcher.service.ts
    messages-unifier.service.ts
    assets.service.ts
    mcp.service.ts
    skills.service.ts
  session-indexers/
    session-indexer.interface.ts
    session-indexer.utils.ts
    claude.session-indexer.ts
    codex.session-indexer.ts
    cursor.session-indexer.ts
    gemini.session-indexer.ts
    index.ts
  tests/
    llm-unifier.providers.test.ts
    llm-unifier.sessions.test.ts
    llm-unifier.images.test.ts
    llm-unifier.mcp.test.ts
    llm-unifier.skills.test.ts
    llm-unifier.messages.test.ts
```

## Responsibilities By File Group

- `llm.routes.ts`
  - HTTP API for provider runtime sessions (start/resume/stop/model/thinking), normalized session/history messages, assets upload, MCP config/probe, skills listing, indexed session CRUD/sync.
- `llm.registry.ts`
  - Singleton provider registry. Instantiates one provider class per provider id.
- `providers/*`
  - Runtime execution and live event collection.
  - SDK family (`BaseSdkProvider`) for Claude/Codex.
  - CLI family (`BaseCliProvider`) for Cursor/Gemini.
- `services/llm.service.ts`
  - Input validation + capability gating + facade over provider registry.
- `services/sessions.service.ts`
  - DB-backed indexed sessions and history file parsing.
  - Returns normalized message history via `messages-unifier.service.ts`.
- `services/sessions-watcher.service.ts`
  - `chokidar` watchers for provider artifact folders.
  - On filesystem update, triggers `synchronizeProviderFile(provider, filePath)`.
- `services/messages-unifier.service.ts`
  - Provider-specific raw event/history -> unified message contract for frontend.
- `services/assets.service.ts`
  - Stores uploaded images in `.cloudcli/assets`.
- `services/mcp.service.ts`
  - Unified MCP CRUD/probe across provider-native config formats/scopes/transports.
- `services/skills.service.ts`
  - Provider-specific skill directory discovery and metadata extraction.
- `session-indexers/*`
  - Scans provider artifacts from disk and upserts indexed sessions into `sessions` DB table.

## Runtime Flow (Provider Sessions)

1. `POST /api/llm/providers/:provider/sessions/start` hits `llm.routes.ts`.
2. Route calls `llmService.startSession(...)`.
3. `llm.service.ts` validates payload and capability constraints.
4. `llm.registry.ts` resolves provider instance.
5. Provider (`BaseSdkProvider` or `BaseCliProvider`) creates an in-memory session record and starts execution.
6. Stream/process output is appended as in-memory `ProviderSessionEvent[]`.
7. Route can either:
   - return `202` immediately with snapshot, or
   - await completion via `waitForSession`.
8. Snapshots are enriched with unified `messages` via `llmMessagesUnifier.normalizeSessionEvents(...)`.

## Indexed History Flow (Disk/DB)

1. Watcher or manual sync scans provider folders.
2. Provider-specific indexer extracts minimal metadata and upserts `sessionsDb`.
3. History endpoints (`/sessions/:sessionId/history`, `/sessions/:sessionId/messages`) read transcript path from DB.
4. JSON/JSONL is parsed and transformed via `llmMessagesUnifier.normalizeHistoryEntries(...)`.

## Interface + Abstract + Base-Class Design

### `IProvider` (interface)
`providers/provider.interface.ts`

- Consumer contract used by registry/service layer.
- Exposes:
  - `launchSession`, `resumeSession`, `stopSession`, `waitForSession`
  - `setSessionModel`, `setSessionThinkingMode`
  - `getSession`, `listSessions`
  - `listModels`
- Exposes `capabilities` so callers can gate unsupported features before calling provider-specific logic.

### `AbstractProvider` (abstract class)
`providers/abstract.provider.ts`

- Shared lifecycle state and rules:
  - `sessions: Map<string, MutableProviderSession>`
  - `sessionPreferences: Map<string, { model?, thinkingMode? }>`
- Implements:
  - in-memory session reads (`getSession`, `listSessions`, `waitForSession`)
  - stop handling + session status events
  - model/thinking updates with capability checks
  - event ring-buffer logic (`MAX_EVENT_BUFFER_SIZE`)
- Leaves provider execution specifics abstract (`listModels`, `launchSession`, `resumeSession`).

### `BaseSdkProvider` and `BaseCliProvider`

- `BaseSdkProvider`
  - shared async iterable stream consumption.
  - handles completion/error transitions and completion system event emission.
- `BaseCliProvider`
  - shared child-process spawn + stdout/stderr line accumulation + JSON line parsing.
  - graceful stop (`SIGTERM` then `SIGKILL`) and completion/error transitions.

### Concrete provider classes

- `ClaudeProvider` (SDK)
  - uses `@anthropic-ai/claude-agent-sdk`.
  - supports runtime permission requests and emits permission events.
  - image payload support via base64 content blocks.
- `CodexProvider` (SDK)
  - dynamic import of `@openai/codex-sdk`.
  - supports text + `local_image` prompt items.
- `CursorProvider` (CLI)
  - `cursor-agent` invocation builder + model list parsing.
- `GeminiProvider` (CLI)
  - `gemini` invocation builder + curated model catalog.

## In-Memory Session Setup: How It Works

The in-memory part is inside `AbstractProvider` + base classes:

- Session record is created at launch/resume in memory (`Map`).
- Events are appended in real-time while stream/process runs.
- Snapshot endpoints read this map directly (`/providers/:provider/sessions...`).
- Stop/wait/model/thinking controls operate on this same in-memory handle.
- Completed sessions currently remain in map (bounded event history per session, but no map eviction).

Key characteristics:

- Process-local only (not shared across instances).
- Lost on server restart.
- Good for immediate live control and progress.
- Not the source of truth for historical transcripts (disk/DB is).

## Is In-Memory Session State Necessary, Or Useless?

Short answer: **not useless**, but **not sufficient as a durable architecture**.

### Why it is necessary in the current design

- You need live handles for:
  - `stopSession` (abort process/stream now),
  - `waitForSession`,
  - real-time event buffering for immediate API responses.
- These are runtime concerns and cannot be satisfied by session-index DB rows alone.

### Where it is weak

- No eviction/pruning for completed session map entries.
- No persistence across restart.
- No cross-instance coordination (if horizontally scaled, only the owning instance can control that session).

### Practical conclusion

- Keep in-memory runtime state for **active execution control**.
- Treat DB/indexed history as the durable read model.
- If you need reliability across restarts/instances, move execution ownership to a durable worker/orchestrator and store live session metadata in a shared store.

## Suggested Hardening (Incremental)

1. Add session map eviction policy (TTL/LRU for completed/failed/stopped sessions).
2. Add ownership metadata (`instanceId`) if multiple backend instances will run.
3. Add explicit `activeSessions` metric endpoint.
4. Optionally persist minimal runtime state (status transitions + timestamps) to DB for auditability.

