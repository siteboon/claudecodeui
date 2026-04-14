# kiro-sdk

A Node.js SDK for programmatic integration with [Kiro CLI](https://kiro.dev/docs/cli/) via the [Agent Client Protocol (ACP)](https://agentclientprotocol.com).

Mirrors the design of `@anthropic-ai/claude-agent-sdk` — the `query()` function returns an `AsyncGenerator<KiroMessage>` that yields typed streaming events.

## Architecture

```
┌─────────────┐     JSON-RPC 2.0      ┌──────────────┐
│  Your App   │ ◄──── stdio ────────► │ kiro-cli acp │
│  (kiro-sdk) │                        │  (long-lived) │
└─────────────┘                        └──────────────┘
```

Unlike Claude's SDK which spawns a new process per query, Kiro uses a single long-lived ACP process. The SDK manages this transparently — callers interact with the same `query()` → `AsyncGenerator` pattern.

## Design Decisions

1. **Same API shape as Claude SDK** — `query()` returns `AsyncGenerator<KiroMessage>`, `Query` has `.interrupt()`, `.setModel()`. Consumers can swap providers with minimal code changes.

2. **Single process, multiplexed sessions** — One `kiro-cli acp` process handles all sessions. The SDK routes notifications by `sessionId` internally.

3. **Lazy process spawn** — The ACP process starts on first `query()` call, not on import. Reconnects automatically if it crashes.

4. **Typed events** — All ACP notification types (`AgentMessageChunk`, `ToolCall`, `ToolCallUpdate`, `TurnEnd`) map to typed `KiroMessage` variants.

## Usage

```js
import { query, disconnect } from 'kiro-sdk';

// Simple one-shot query (mirrors Claude SDK exactly)
const conversation = query({
  prompt: 'Explain this codebase',
  options: { cwd: '/my/project' }
});

for await (const message of conversation) {
  switch (message.type) {
    case 'assistant':
      process.stdout.write(message.content);
      break;
    case 'tool_use':
      console.log(`Tool: ${message.name}`, message.input);
      break;
    case 'tool_progress':
      process.stdout.write(message.content);
      break;
    case 'result':
      console.log('Done. Full text:', message.text);
      break;
  }
}

// Resume a session
const resumed = query({
  prompt: 'Now fix the auth bug',
  options: { resume: conversation.sessionId }
});

// Interrupt mid-stream
setTimeout(() => conversation.interrupt(), 5000);

// Change model mid-session
await conversation.setModel('claude-opus-4.6');

// Clean up on shutdown
disconnect();
```

## API Reference

See [src/types.ts](src/types.ts) for full type definitions.

### `query(params)` → `Query`

| Param | Type | Description |
|---|---|---|
| `prompt` | `string` | User message |
| `options.cwd` | `string` | Working directory (default: `process.cwd()`) |
| `options.resume` | `string` | Session ID to resume |
| `options.model` | `string` | Model ID (e.g. `claude-sonnet-4.6`). Omit for auto |
| `options.agent` | `string` | Agent profile name |
| `options.trustAllTools` | `boolean` | Auto-approve all tool permission requests |
| `options.trustTools` | `string[]` | Specific tools to auto-approve |
| `options.mcpServers` | `object[]` | MCP server configurations |
| `options.abortController` | `AbortController` | Cancellation signal |

### `Query` (AsyncGenerator\<KiroMessage\>)

| Property / Method | Description |
|---|---|
| `sessionId` | ACP session ID (available after first yield) |
| `interrupt()` | Cancel the current turn |
| `setModel(model)` | Change model for subsequent turns |

### `disconnect()`

Shuts down the ACP process. Call on application exit.

### `KiroMessage` types

| Type | Fields | ACP Source |
|---|---|---|
| `assistant` | `content`, `session_id` | `AgentMessageChunk` |
| `tool_use` | `name`, `input`, `status`, `id` | `ToolCall` |
| `tool_progress` | `content`, `tool_id` | `ToolCallUpdate` |
| `result` | `session_id`, `is_error`, `text` | `TurnEnd` |

## Testing

```bash
# Unit tests (mocked, no kiro-cli required)
npm test

# Integration tests (requires kiro-cli installed and authenticated)
npm run test:integration
```

### Test Coverage

- **19 unit tests** — SessionRouter, AcpTransport, public API (all mocked)
- **4 integration tests** — real `kiro-cli acp` process: initialize, session/new, MCP notifications, session/prompt streaming

## Known Limitations

- **`session/resume` not working** — As of `kiro-cli` v1.29.x, `session/load` followed by `session/prompt` crashes the ACP process. The SDK always creates a new session as a workaround. The `resume` option is accepted but ignored until the kiro-cli bug is fixed.
- **No per-message timestamps** — Kiro session JSONL files don't include timestamps on individual messages. The SDK uses synthetic incrementing timestamps to preserve ordering.

## File Structure

```
kiro-sdk/
├── package.json
├── README.md
├── vitest.config.ts                # Unit test config
├── vitest.integration.config.ts    # Integration test config
├── src/
│   ├── index.ts                    # Public API: query(), disconnect()
│   ├── types.ts                    # KiroMessage, Options, Query types
│   ├── acp-transport.ts            # JSON-RPC over stdio transport
│   ├── session.ts                  # Session routing + async generator
│   ├── session.test.ts             # SessionRouter unit tests
│   ├── acp-transport.test.ts       # Transport unit tests
│   ├── index.test.ts               # Public API unit tests
│   └── integration.test.ts         # Real kiro-cli integration tests
└── tsconfig.json
```

## License

MIT
