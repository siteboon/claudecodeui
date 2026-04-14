# kiro-sdk (Python)

A Python SDK for programmatic integration with [Kiro CLI](https://kiro.dev/docs/cli/) via the [Agent Client Protocol (ACP)](https://agentclientprotocol.com).

Port of the [TypeScript kiro-sdk](../kiro-sdk/) — the `query()` function returns an async iterable of typed `KiroMessage` events.

## Architecture

```
┌─────────────┐     JSON-RPC 2.0      ┌──────────────┐
│  Your App   │ ◄──── stdio ────────► │ kiro-cli acp │
│  (kiro_sdk) │                        │  (long-lived) │
└─────────────┘                        └──────────────┘
```

Single long-lived ACP process, multiplexed sessions, lazy spawn on first `query()`.

## Install

```bash
pip install -e ./kiro-sdk-python
```

Requires Python 3.10+ and `kiro-cli` installed and on PATH (or set `KIRO_PATH`).

## Usage

```python
import asyncio
from kiro_sdk import query, disconnect

async def main():
    conversation = query(prompt="Explain this codebase", cwd="/my/project")

    async for message in conversation:
        match message.type:
            case "assistant":
                print(message.content, end="")
            case "tool_use":
                print(f"Tool: {message.name}", message.input)
            case "tool_progress":
                print(message.content, end="")
            case "result":
                print(f"\nDone. Full text length: {len(message.text)}")

    # Resume a session
    resumed = query(
        prompt="Now fix the auth bug",
        options=Options(resume=conversation.session_id),
    )

    # Interrupt mid-stream
    await conversation.interrupt()

    # Change model
    await conversation.set_model("claude-opus-4.6")

    # Clean up
    disconnect()

asyncio.run(main())
```

## API Reference

### `query(prompt, options=None, **kwargs)` → `Query`

| Param | Type | Description |
|---|---|---|
| `prompt` | `str` | User message |
| `options` | `Options` | Configuration (or pass fields as kwargs) |

### `Options`

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | `str \| None` | `os.getcwd()` | Working directory |
| `resume` | `str \| None` | `None` | Session ID to resume |
| `model` | `str \| None` | `None` | Model ID |
| `agent` | `str \| None` | `None` | Agent profile name |
| `trust_all_tools` | `bool` | `False` | Auto-approve all tools |
| `trust_tools` | `list[str]` | `[]` | Specific tools to auto-approve |
| `mcp_servers` | `list[dict]` | `[]` | MCP server configurations |

### `Query`

Async iterable of `KiroMessage`. Also exposes:

| Property / Method | Description |
|---|---|
| `session_id` | ACP session ID (set after iteration starts) |
| `await interrupt()` | Cancel the current turn |
| `await set_model(model)` | Change model for subsequent turns |

### `disconnect()`

Shuts down the ACP process.

### `KiroMessage` types

| Type | Class | Key Fields |
|---|---|---|
| `"assistant"` | `KiroAssistantMessage` | `content`, `session_id` |
| `"tool_use"` | `KiroToolUseMessage` | `name`, `input`, `status`, `id` |
| `"tool_progress"` | `KiroToolProgressMessage` | `content`, `tool_id` |
| `"result"` | `KiroResultMessage` | `session_id`, `is_error`, `text` |

## File Structure

```
kiro-sdk-python/
├── pyproject.toml
├── pytest.ini
├── README.md
├── kiro_sdk/
│   ├── __init__.py          # Public re-exports
│   ├── types.py             # Dataclasses for messages and options
│   ├── acp_transport.py     # JSON-RPC over stdio transport
│   ├── session.py           # Session routing + async generator
│   └── api.py               # query(), disconnect(), Query class
└── tests/
    └── test_integration.py  # End-to-end tests against real kiro-cli
```

## Testing

```bash
pip install -e ".[dev]"
pytest tests/test_integration.py -v -s
```

Requires `kiro-cli` installed and authenticated.

### Test Coverage

- **3 low-level tests** — raw subprocess JSON-RPC: initialize, session/new, session/prompt streaming
- **1 SDK-level e2e test** — full round-trip through `query()` → async iteration → result

## Known Limitations

- **`session/resume` not working** — As of `kiro-cli` v1.29.x, `session/load` followed by `session/prompt` crashes the ACP process. The SDK always creates a new session as a workaround.
- No per-message timestamps from Kiro session files

## License

MIT
