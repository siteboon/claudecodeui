# Phase 0.3: ZCode Event Stream Specification

**Generated:** 2026-08-17  
**ZCode Version:** 0.16.3 (CLI) / 3.7.7 (Desktop App)  
**Purpose:** Document exact payload structures for ZCode event streams to enable message normalization in CloudCLI integration

## Executive Summary

This specification captures two complementary data sources:

1. **Live Event Stream** (`transcript.jsonl`): Real-time streaming events during model execution
2. **SQLite Stored Format** (`message`/`part` tables): Persisted message history for session reconstruction

**Key Finding**: ZCode uses fundamentally different event structures between streaming and storage, requiring normalization for CloudCLI's unified message pipeline.

---

## 1. Event Catalog

### 1.1 Streaming Events (Live Protocol)

**Source**: `~/.zcode/cli/agents/<session>/agent_<id>/transcript.jsonl`  
**Format**: Line-delimited JSON with `type` field discriminator

| Event Type | Purpose | Key Fields | Example JSON |
|:---|:---|:---|:---|
| `turn_started` | Turn lifecycle: Beginning of user-assistant interaction | `sessionId`, `turnId`, `payload.input` | `{"type":"turn_started","sessionId":"sess_*","turnId":"turn_*","payload":{"turnNumber":0,"input":"..."}}` |
| `model_request` | Model lifecycle: Request submitted to provider | `payload.messages`, `payload.model`, `payload.toolCount` | See full example below |
| `model_network_status` | Model lifecycle: Network transport details | `payload.baseURL`, `payload.transport` (sse) | `{"type":"model_network_status","payload":{"baseURL":"https://open.bigmodel.cn/api/anthropic","transport":"sse"}}` |
| `model_streaming` | **Content delivery**: Streaming deltas with kind discriminator | `payload.kind`, `payload.delta`, `payload.done` | See Streaming Kinds below |
| `tool_call_scheduled` | Tool lifecycle: Tool call scheduled for execution | `payload.toolCallId`, `payload.toolName`, `payload.input` | See Tool Events section |
| `tool_batch_complete` | Tool lifecycle: Batch execution completed | `payload.toolCallIds`, `payload.successCount`, `payload.errorCount` | `{"type":"tool_batch_complete","payload":{"toolCallIds":["call_*"],"successCount":1,"errorCount":0}}` |
| `model_complete` | Model lifecycle: Provider response finished | `payload.stopReason`, `payload.usage`, `payload.toolCallCount` | See Completion Events section |
| `turn_complete` | Turn lifecycle: Full interaction completed | `payload.response`, `payload.usage`, `payload.duration` | See Completion Events section |

#### Streaming Event Kinds (`model_streaming`)

| Kind | Purpose | Delta Field | Example |
|:---|:---|:---|:---|
| `start` | Response start | `delta: ""` | `{"kind":"start","delta":"","done":false}` |
| `reasoning_start` | Thinking content begins | `delta: ""` | `{"kind":"reasoning_start","delta":"","done":false}` |
| `reasoning_delta` | Thinking content increment | `delta: "<text>"` | `{"kind":"reasoning_delta","delta":"Let me start","done":false}` |
| `reasoning_end` | Thinking content finished | `delta: ""` | `{"kind":"reasoning_end","delta":"","done":false}` |
| `text_start` | Response text begins | `delta: ""` | `{"kind":"text_start","delta":"","done":false}` |
| `text_delta` | Response text increment | `delta: "<text>"` | `{"kind":"text_delta","delta":"现在我来","done":false}` |
| `text_end` | Response text finished | `delta: ""` | `{"kind":"text_end","delta":"","done":false}` |
| `tool_call` | Tool call announcement | `delta: ""`, `input`, `toolName`, `toolCallId` | See Tool Events section |
| `tool_input_start` | Tool input streaming begins | `delta: ""` | `{"kind":"tool_input_start","delta":"","done":false}` |
| `tool_input_delta` | Tool input increment | `delta: "<text>"` | `{"kind":"tool_input_delta","delta":"find ","done":false}` |
| `tool_input_end` | Tool input streaming finished | `delta: ""` | `{"kind":"tool_input_end","delta":"","done":false}` |
| `tool_result` | Tool execution result | `resultPartId`, `toolCallId` | `{"kind":"tool_result","toolCallId":"call_*","resultPartId":"part_*"}` |
| `finish` | Stream fully complete | `delta: ""` | `{"kind":"finish","delta":"","done":true}` |

### 1.2 SQLite Stored Events

**Source**: `~/.zcode/cli/db/db.sqlite` tables  
**Format**: Relational tables with JSON `data` columns

#### Message Table Structure

**Schema**:
```sql
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL,  -- JSON payload
  sequence INTEGER
);
```

**Message.data Key Fields**:

| Field | Type | Purpose | Example Value |
|:---|:---|:---|:---|
| `role` | string | Message role | `"assistant"`, `"user"` |
| `modelID` | string | Model identifier | `"GLM-4.7"`, `"GLM-5.3"` |
| `providerID` | string | Provider identifier | `"builtin:bigmodel-coding-plan"` |
| `variant` | string | Reasoning variant | `"high"`, `"low"`, `"max"` |
| `mode` | string | Permission mode | `"edit"`, `"yolo"`, `"plan"` |
| `tokens` | object | Token usage breakdown | See Token Usage section |
| `finish` | string | Completion status | `"completed"`, `"tool-calls"`, `"stop"` |
| `semantics.kind` | string | Message semantic type | `"assistant_response"`, `"user_prompt"`, `"timeline_event"` |
| `time` | object | Timestamps | `{"created": 1786958962229, "completed": 1786958966412}` |
| `path` | object | Execution context | `{"cwd": "/path/to/workspace", "root": "/path/to/workspace"}` |
| `parentID` | string | Parent message ID | `"msg_*"` |

#### Part Table Structure

**Schema**:
```sql
CREATE TABLE part (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL,  -- JSON payload
  sequence INTEGER
);
```

**Part.data Type Discriminator** (`type` field):

| Type | Purpose | Additional Fields | Example |
|:---|:---|:---|:---|
| `text` | Response text content | `text`, `time.{start,end}` | `{"type":"text","text":"I'll help you","time":{"start":1786958962229,"end":1786958966396}}` |
| `reasoning` | Thinking content | `text`, `metadata`, `time` | `{"type":"reasoning","text":"Let me analyze...","metadata":{"anthropic":{"signature":"..."}}}` |
| `tool` | Tool execution record | `callID`, `tool`, `state.{status,input,output}` | See Tool Events section |
| `step-start` | Workflow step begins | (empty object) | `{"type":"step-start"}` |
| `step-finish` | Workflow step ends | (empty object) | `{"type":"step-finish"}` |
| `timeline` | Timeline event | `timelineType`, `display`, `status` | `{"type":"timeline","timelineType":"model_change","display":"separator"}` |

---

## 2. Token Usage Documentation

### 2.1 Streaming Format (`model_complete` event)

**Path**: `event.payload.usage`

**Structure**:
```typescript
{
  inputTokens: number;      // Input token count
  outputTokens: number;     // Output token count  
  totalTokens: number;      // Total (input + output)
  cacheReadTokens: number;  // Cache read tokens
  cacheWriteTokens: number; // Cache write tokens
}
```

**Example**:
```json
{
  "type": "model_complete",
  "payload": {
    "stopReason": "tool-calls",
    "usage": {
      "inputTokens": 6792,
      "outputTokens": 128,
      "totalTokens": 6920,
      "cacheReadTokens": 3264,
      "cacheWriteTokens": 0
    },
    "toolCallCount": 2
  }
}
```

### 2.2 Turn-Level Aggregation (`turn_complete` event)

**Path**: `event.payload.usage`

**Structure**:
```typescript
{
  source: "provider";
  modelRequestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;  // Separate reasoning token tracking
  webFetchRequests: number;
  webSearchRequests: number;
}
```

**Example**:
```json
{
  "type": "turn_complete",
  "payload": {
    "usage": {
      "source": "provider",
      "modelRequestCount": 14,
      "inputTokens": 565902,
      "outputTokens": 9160,
      "totalTokens": 575062,
      "cacheReadTokens": 495744,
      "cacheWriteTokens": 0,
      "reasoningTokens": 0
    },
    "duration": 176322,
    "toolCallCount": 42,
    "resultType": "success"
  }
}
```

### 2.3 SQLite Storage Format (`message.data.tokens`)

**Path**: `JSON.parse(message.data).tokens`

**Structure**:
```typescript
{
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  }
}
```

**Example**:
```json
{
  "tokens": {
    "total": 16541,
    "input": 16462,
    "output": 79,
    "reasoning": 0,
    "cache": {
      "read": 10688,
      "write": 0
    }
  }
}
```

**Field Mapping Between Formats**:

| CloudCLI Normalized | Streaming (`model_complete`) | SQLite (`message.data`) |
|:---|:---|:---|
| `tokens.input` | `usage.inputTokens` | `tokens.input` |
| `tokens.output` | `usage.outputTokens` | `tokens.output` |
| `tokens.total` | `usage.totalTokens` | *(computed)* `input + output` |
| `tokens.reasoning` | `usage.reasoningTokens` | `tokens.reasoning` |
| `tokens.cacheRead` | `usage.cacheReadTokens` | `tokens.cache.read` |
| `tokens.cacheWrite` | `usage.cacheWriteTokens` | `tokens.cache.write` |

---

## 3. Tool Call Specification

### 3.1 Streaming Tool Events

#### Tool Call Announcement (`kind: "tool_call"`)

**Event**: `model_streaming` with `kind: "tool_call"`

**Structure**:
```typescript
{
  type: "model_streaming";
  payload: {
    assistantMessageId: string;
    kind: "tool_call";
    toolCallId: string;      // Format: "call_<uuid>"
    toolName: string;        // e.g., "Read", "Bash", "Edit"
    input: object;           // Tool-specific input parameters
    delta: "";               // Always empty for tool_call kind
    done: false;
  }
}
```

**Example**:
```json
{
  "type": "model_streaming",
  "payload": {
    "assistantMessageId": "msg_mswyv7n1_e4d61a3b-d98b-462c-99ed-4c0626252364",
    "kind": "tool_call",
    "toolCallId": "call_f9bcb13a02ea4c35a8f2cde6",
    "toolName": "Bash",
    "input": {
      "command": "find /Users/azrael/workspaces/feihua-ling/src/components -type f",
      "description": "List all files in components directory"
    },
    "delta": "",
    "done": false
  }
}
```

#### Tool Execution Scheduling (`tool_call_scheduled`)

**Event**: Separate `tool_call_scheduled` event type (not streaming)

**Structure**:
```typescript
{
  type: "tool_call_scheduled";
  payload: {
    toolCallId: string;
    toolName: string;
    input: object;
    dependencies: string[];
    parallelGroupIndex: number;
    canRunParallel: boolean;
    schedule: {
      parallelGroups: string[][];
      executionOrder: string[];
    };
  }
}
```

#### Tool Result (`kind: "tool_result"`)

**Event**: `stream_recovery_anchor_created` with `payload.kind: "tool_result"` OR embedded in streaming

**Structure**:
```typescript
{
  type: "stream_recovery_anchor_created";
  payload: {
    kind: "tool_result";
    toolCallId: string;
    toolName: string;
    resultPartId: string;     // Format: "part_<uuid>"
    assistantMessageId: string;
    committedToolCallIds: string[];
    committedAt: string;      // ISO timestamp
  }
}
```

### 3.2 SQLite Tool Events

**Storage Location**: `part` table with `type: "tool"`

**Structure**:
```typescript
{
  type: "tool";
  callID: string;            // Matches streaming `toolCallId`
  tool: string;              // Matches streaming `toolName`
  state: {
    status: "completed" | "running" | "failed";
    input: object;           // Same as streaming input
    output: string | object; // Tool execution result
  };
}
```

**Example (Read tool)**:
```json
{
  "type": "tool",
  "callID": "call_b6ac32e536574eb7808bc839",
  "tool": "Read",
  "state": {
    "status": "completed",
    "input": {
      "file_path": "/Users/azrael/workspaces/cloudcli/docs/zcode-integration-plan.md"
    },
    "output": "1\t# ZCode Provider 接入实现计划...\n2\t\n3\t本计划基于..."
  }
}
```

**Example (Bash tool)**:
```json
{
  "type": "tool",
  "callID": "call_e1e62e9241c34c0b9360d444",
  "tool": "Agent", 
  "state": {
    "status": "running",
    "input": {
      "skill": "research",
      "args": "analyze codebase structure"
    },
    "output": "Starting research agent..."
  }
}
```

### 3.3 Error Indication Format

**Streaming Errors**: Not directly observed in tool events—errors appear in separate log entries

**SQLite Errors**: 
```typescript
{
  type: "tool";
  state: {
    status: "failed";
    input: object;
    output: string;  // Error message
  };
}
```

**Batch Error Tracking** (`tool_batch_complete`):
```typescript
{
  type: "tool_batch_complete";
  payload: {
    toolCallIds: string[];
    successCount: number;
    errorCount: number;  // Non-zero indicates errors
  }
}
```

---

## 4. Message Normalization Mapping

### 4.1 ZCode → NormalizedMessage Mapping

**Target**: CloudCLI `NormalizedMessage` interface (per integration guide §4)

| ZCode Source | NormalizedMessage.kind | Field Transformations |
|:---|:---|:---|
| **Streaming Events** | | |
| `model_streaming.kind: "reasoning_delta"` | `thinking` | `text ← payload.delta`, `metadata.kind ← "reasoning_delta"` |
| `model_streaming.kind: "reasoning_start/end"` | `thinking` | `text ← ""` (boundary markers) |
| `model_streaming.kind: "text_delta"` | `stream_delta` | `text ← payload.delta`, `role ← "assistant"` |
| `model_streaming.kind: "text_start/end"` | `text` | `text ← ""` (boundary markers) |
| `model_streaming.kind: "tool_call"` | `tool_use` | See Tool Use Mapping below |
| `model_streaming.kind: "tool_result"` | `tool_result` | See Tool Result Mapping below |
| `model_complete` | `complete` | See Completion Mapping below |
| **SQLite Events** | | |
| `message.data.role: "assistant"` + `part.type: "text"` | `text` | `text ← part.data.text`, `role ← "assistant"` |
| `message.data.role: "user"` | `text` | `text ← message.data.text content`, `role ← "user"` |
| `part.type: "reasoning"` | `thinking` | `text ← part.data.text` |
| `part.type: "tool"` | `tool_use` | See Tool Use Mapping below |
| `message.data.finish: "completed"` | `complete` | See Completion Mapping below |

### 4.2 Tool Use Field Mapping

**Target Structure**:
```typescript
{
  kind: "tool_use";
  toolName: string;
  toolId: string;      // Optional
  toolInput: object;
}
```

**ZCode Streaming → Normalized**:
```typescript
// From: model_streaming.kind: "tool_call"
{
  kind: "tool_use",
  toolName: event.payload.toolName,
  toolId: event.payload.toolCallId,  // Use toolCallId as toolId
  toolInput: event.payload.input
}
```

**ZCode SQLite → Normalized**:
```typescript
// From: part.type: "tool"
{
  kind: "tool_use",
  toolName: part.data.tool,
  toolId: part.data.callID,  // Use callID as toolId
  toolInput: part.data.state.input
}
```

### 4.3 Tool Result Field Mapping

**Target Structure**:
```typescript
{
  kind: "tool_result";
  toolResult: {
    content: string | object;
    isError: boolean;
  };
  toolId?: string;  // For result correlation
}
```

**ZCode Streaming → Normalized**:
```typescript
// From: stream_recovery_anchor_created with kind: "tool_result"
{
  kind: "tool_result",
  toolId: event.payload.toolCallId,
  toolResult: {
    content: `Result available via part ID: ${event.payload.resultPartId}`,
    isError: false  // Parse from errorCount in corresponding tool_batch_complete
  }
}
```

**ZCode SQLite → Normalized**:
```typescript
// From: part.type: "tool" with status: "completed"
{
  kind: "tool_result",
  toolId: part.data.callID,
  toolResult: {
    content: part.data.state.output,
    isError: part.data.state.status === "failed"
  }
}
```

### 4.4 Completion Event Mapping

**Target Structure**:
```typescript
{
  kind: "complete";
  tokens: {
    input: number;
    output: number;
    total: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  status: "success" | "error" | "stopped";
}
```

**ZCode Streaming → Normalized**:
```typescript
// From: model_complete
{
  kind: "complete",
  tokens: {
    input: event.payload.usage.inputTokens,
    output: event.payload.usage.outputTokens,
    total: event.payload.usage.totalTokens,
    cacheRead: event.payload.usage.cacheReadTokens,
    cacheWrite: event.payload.usage.cacheWriteTokens
  },
  status: event.payload.stopReason === "tool-calls" ? "success" : "stopped"
}
```

**ZCode SQLite → Normalized**:
```typescript
// From: message.data.finish: "completed"
const tokens = JSON.parse(message.data).tokens;
{
  kind: "complete",
  tokens: {
    input: tokens.input,
    output: tokens.output,
    total: tokens.input + tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write
  },
  status: "success"
}
```

---

## 5. Key Architectural Differences

### 5.1 Streaming vs Storage Divergence

| Aspect | Streaming (Live) | SQLite (Storage) |
|:---|:---|:---|
| **Event Granularity** | Fine-grained deltas per character | Coarse message/part aggregates |
| **Tool Correlation** | Multiple events: `tool_call` → `tool_batch_complete` → `tool_result` | Single `part` with complete state |
| **Token Reporting** | In `model_complete` (per model call) + `turn_complete` (aggregated) | In `message.data.tokens` (per message) |
| **Reasoning Content** | Separate `reasoning_delta` stream events | Dedicated `part.type: "reasoning"` rows |
| **ID Consistency** | `assistantMessageId` references separate from message IDs | Direct `message.id` and `part.id` references |

### 5.2 ID Field Mapping

| Entity | Streaming ID | SQLite ID | NormalizedMessage ID |
|:---|:---|:---|:---|
| **Message** | `assistantMessageId` (format: `msg_*`) | `message.id` (format: `msg_part_*`) | Use `message.id` (SQLite) or derive from session+seq (streaming) |
| **Part** | Embedded in streaming content | `part.id` (format: `part_*`) | Use `part.id` when available |
| **Tool Call** | `toolCallId` (format: `call_*`) | `part.data.callID` | Use `toolCallId`/`callID` as `toolId` |
| **Turn** | `turnId` (format: `turn_*`) | *(not directly stored)* | Use for grouping but not persist in NormalizedMessage |

### 5.3 Content Reconstruction Strategy

**From Streaming**: Accumulate deltas by `assistantMessageId` + `kind`

1. **Text content**: Concatenate all `kind: "text_delta"` with matching `assistantMessageId`
2. **Reasoning content**: Concatenate all `kind: "reasoning_delta"` 
3. **Tool calls**: Extract from `kind: "tool_call"` events
4. **Tool results**: Cross-reference `tool_result.kind` events with `tool_batch_complete`

**From SQLite**: Query `message` + `part` tables joined by `message_id`

1. **Text content**: Extract from `part.type: "text"` rows
2. **Reasoning content**: Extract from `part.type: "reasoning"` rows  
3. **Tool calls**: Extract from `part.type: "tool"` rows
4. **Tool results**: Use `part.data.state.output` field

---

## 6. Permission/Authorization Events

### 6.1 Observed Permission Modes

**Source**: `message.data.mode` field (SQLite) and session configuration

| Mode | Purpose | Behavior |
|:---|:---|:---|
| `"yolo"` | Unrestricted execution | All tools auto-approved |
| `"edit"` | Edit-focused permissions | File operations allowed |
| `"plan"` | Planning mode | Read-only analysis |
| `"build"` | Build context | Development permissions |
| `"auto"` | Automatic mode | Dynamic permission adjustment |

### 6.2 Permission Event Structure

**Finding**: **No explicit permission request events found** in either streaming or SQLite formats.

**Implications**:
1. ZCode handles permissions **before** tool execution (configuration-based)
2. No equivalent to Claude's `permission_request` event type
3. CloudCLI should map ZCode modes to permission modes (see integration plan §5)
4. Tool approval UI not applicable for ZCode integration (Phase 1)

**Permission Detection Strategy**:
- Read from `message.data.mode` in SQLite
- Inferred from session configuration during streaming
- No runtime approval events to normalize

---

## 7. Implementation Notes

### 7.1 Critical Field Renames

| ZCode Field | NormalizedMessage Field | Notes |
|:---|:---|:---|
| `toolCallId` / `callID` | `toolId` | Tool identifier normalization |
| `input` (tool) | `toolInput` | Consistent naming convention |
| `output` (tool result) | `toolResult.content` | Nested structure for results |
| `delta` (streaming) | `text` | Flatten streaming deltas to text content |
| `tokens.totalTokens` | `tokens.total` | Remove redundant "Tokens" suffix |

### 7.2 Data Type Conversions

| ZCode Type | NormalizedMessage Type | Conversion Logic |
|:---|:---|:---|
| Token counts (number) | Token counts (number) | Direct mapping |
| Timestamp strings (ISO) | Epoch milliseconds | Parse ISO strings to numbers |
| Cache tokens object | Flat cache fields | Extract `.read` / `.write` to top level |
| Boolean status strings | Boolean `isError` | Map `"failed"` → `true`, others → `false` |

### 7.3 Missing Event Handling

| Event Type | Handling Strategy |
|:---|:---|
| `permission_request` | **Not emitted** by ZCode (see §6.2) |
| `error` (streaming) | Parse from `tool_batch_complete.errorCount > 0` |
| File attachment events | Not observed—assume inline references |
| Metadata-only events | Filter out from `NormalizedMessage` output |

---

## 8. Validation Checklist

Based on this specification, the following validation steps are required:

- [ ] **Streaming delta accumulation**: Verify text concatenation from `text_delta` events matches final SQLite `part.type: "text"` content
- [ ] **Tool call ID correlation**: Confirm `toolCallId` (streaming) matches `callID` (SQLite) for same operations
- [ ] **Token calculation**: Validate `input + output = total` in both formats
- [ ] **Reasoning content extraction**: Test `reasoning_delta` accumulation vs SQLite `part.type: "reasoning"`
- [ ] **Completion timing**: Verify `model_complete` occurs after all tool `tool_result` events
- [ ] **Error propagation**: Test tool error detection via `tool_batch_complete.errorCount`
- [ ] **Permission mode mapping**: Validate `mode` field values match expected permission modes

---

## 9. Sample Event Sequence

### Complete Turn Flow (Streaming + SQLite)

**User Prompt** → **Model Request** → **Reasoning Stream** → **Text Stream** → **Tool Call** → **Tool Execution** → **Tool Result** → **Model Complete** → **Turn Complete**

**Streaming Event Sequence**:
1. `turn_started` (input prompt)
2. `model_request` (request to provider)
3. `model_streaming.kind: "start"`
4. `model_streaming.kind: "reasoning_start"`  
5. `model_streaming.kind: "reasoning_delta"` (multiple)
6. `model_streaming.kind: "reasoning_end"`
7. `model_streaming.kind: "text_start"`
8. `model_streaming.kind: "text_delta"` (multiple)
9. `model_streaming.kind: "tool_call"` (Bash tool)
10. `tool_call_scheduled` (scheduling metadata)
11. `model_streaming.kind: "tool_input_start"`
12. `model_streaming.kind: "tool_input_delta"` (command construction)
13. `model_streaming.kind: "tool_input_end"`
14. `tool_batch_complete` (execution finished)
15. `model_streaming.kind: "tool_result"` (result reference)
16. `model_streaming.kind: "text_delta"` (response continues)
17. `model_complete` (model response finished)
18. `turn_complete` (full turn finished)

**SQLite Storage Equivalent**:
1. `message` row: `role: "user"` (user prompt)
2. `message` row: `role: "assistant"`, `finish: "tool-calls"` (assistant response)
3. `part` row: `type: "reasoning"` (thinking content)
4. `part` row: `type: "text"` (response text)
5. `part` row: `type: "tool"` (tool execution record)
6. `message` row: `role: "assistant"`, `finish: "completed"` (final response)

---

## 10. References

- **Integration Plan**: `/Users/azrael/workspaces/cloudcli/docs/zcode-integration-plan.md` (§4 message normalization)
- **SQLite Database**: `~/.zcode/cli/db/db.sqlite` (read-only access required)
- **Transcript Files**: `~/.zcode/cli/agents/<session>/agent_<id>/transcript.jsonl`
- **ZCode Version**: CLI 0.16.3 / Desktop App 3.7.7
- **Data Collection**: 2026-08-17 from active development sessions

---

**Document Status**: Final specification for Phase 0.3 validation. Ready for implementation of `zcode-sessions.provider.ts` normalization logic.