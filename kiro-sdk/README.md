# kiro-sdk

A Node.js SDK for programmatic integration with [Kiro CLI](https://kiro.dev/docs/cli/) via the [Agent Client Protocol (ACP)](https://agentclientprotocol.com).

Mirrors the design of `@anthropic-ai/claude-agent-sdk` — the `query()` function returns an `AsyncGenerator<KiroMessage>` that yields typed streaming events.

## Design

### Architecture

```
┌─────────────┐     JSON-RPC 2.0      ┌──────────────┐
│  Your App   │ ◄──── stdio ────────► │ kiro-cli acp │
│  (kiro-sdk) │                        │  (long-lived) │
└─────────────┘                        └──────────────┘
```

Unlike Claude's SDK which spawns a new process per query, Kiro uses a single long-lived ACP process. The SDK manages this transparently — callers interact with the same `query()` → `AsyncGenerator` pattern.

### Key Design Decisions

1. **Same API shape as Claude SDK** — `query()` returns `AsyncGenerator<KiroMessage>`, `Query` has `.interrupt()`, `.setModel()`. Consumers can swap providers with minimal code changes.

2. **Single process, multiplexed sessions** — One `kiro-cli acp` process handles all sessions. The SDK routes notifications by `sessionId` internally.

3. **Lazy process spawn** — The ACP process starts on first `query()` call, not on import. Reconnects automatically if it crashes.

4. **Typed events** — All ACP notification types (`AgentMessageChunk`, `ToolCall`, `ToolCallUpdate`, `TurnEnd`) map to typed `KiroMessage` variants.

## Usage

```js
import { query } from 'kiro-sdk';

// Simple one-shot query (mirrors Claude SDK exactly)
const conversation = query({
  prompt: 'Explain this codebase',
  options: { cwd: '/my/project' }
});

for await (const message of conversation) {
  if (message.type === 'assistant') {
    process.stdout.write(message.content);
  }
}

// Resume a session
const resumed = query({
  prompt: 'Now fix the auth bug',
  options: { resume: 'session-uuid-here' }
});

// Interrupt mid-stream
setTimeout(() => conversation.interrupt(), 5000);

// Change model
await conversation.setModel('claude-opus-4.6');
```

## API Reference

See [src/types.ts](src/types.ts) for full type definitions.

### `query(params)` → `Query`

| Param | Type | Description |
|---|---|---|
| `prompt` | `string` | User message |
| `options.cwd` | `string` | Working directory |
| `options.resume` | `string` | Session ID to resume |
| `options.model` | `string` | Model to use |
| `options.agent` | `string` | Agent profile name |
| `options.trustAllTools` | `boolean` | Auto-approve all tools |
| `options.trustTools` | `string[]` | Tools to auto-approve |
| `options.abortController` | `AbortController` | Cancellation signal |

### `Query` (AsyncGenerator<KiroMessage>)

| Method | Description |
|---|---|
| `interrupt()` | Cancel current turn |
| `setModel(model)` | Change model mid-session |

### `KiroMessage` types

| Type | Fields | ACP Source |
|---|---|---|
| `assistant` | `content`, `session_id` | `AgentMessageChunk` |
| `tool_use` | `name`, `input`, `status`, `id` | `ToolCall` |
| `tool_progress` | `content`, `tool_id` | `ToolCallUpdate` |
| `result` | `session_id`, `is_error` | `TurnEnd` |

## File Structure

```
kiro-sdk/
├── package.json
├── README.md
├── src/
│   ├── index.ts          # Public API: query(), listSessions()
│   ├── types.ts           # KiroMessage, Options, Query types
│   ├── acp-transport.ts   # JSON-RPC over stdio (spawn, send, receive)
│   └── session.ts         # Session state, notification routing
└── tsconfig.json
```
