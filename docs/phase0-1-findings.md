# Phase 0.1 Validation Findings

**Date:** 2026-08-17  
**Validation Script:** `/Users/azrael/workspaces/cloudcli/scripts/zcode-phase0-1-validation.js`  
**Engine Path:** `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`  
**ZCode Version:** 0.16.3

---

## Executive Summary

✅ **Phase 0.1 validation completed successfully.** The ZCode app-server protocol is functional and well-structured. While the full conversation flow couldn't be tested due to inactive session limitations, we successfully validated the core protocol mechanics and discovered critical implementation details.

**Key Achievement:** The app-server starts reliably, protocol communication works bidirectionally, and we've captured the exact protocol structures needed for implementation.

---

## Protocol Validation Results

### ✅ Confirmed Working

1. **App-server Startup:** Reliable startup with `node zcode.cjs app-server`
2. **Basic Protocol:** Line-delimited JSON with proper request/response correlation
3. **Session Listing:** `session/list` returns complete session metadata
4. **Server Requests:** Bidirectional protocol with server-initiated requests
5. **Graceful Shutdown:** Clean process termination with exit code 0

### ⚠️ Partial Validation

- **Session Operations:** Limited by inactive session state (expected behavior)
- **Event Streaming:** No live events captured due to session state, but protocol structure validated
- **Model Configuration:** Configuration dependency discovered but not fully tested

---

## Critical Protocol Discoveries

### 1. Message Structure (Line-Delimited JSON)

**Confirmed:** The protocol uses line-delimited JSON, **NOT** JSON-RPC 2.0.

```json
// Client Request
{"id":1,"method":"session/list","params":{}}

// Server Response  
{"id":1,"result":{"sessions":[...]}}

// Server Request (bidirectional)
{"id":"server-1","method":"session/requestRuntimePreferences","params":{"sessionId":"...","scope":"..."}}

// Client Response to Server
{"id":"server-1","result":{"nativeSearchEnhancementsEnabled":false}}

// Error Response
{"id":2,"error":{"code":-32004,"message":"Session is not active: sess_..."}}
```

**Key Discovery:** The server can initiate requests to the client using string IDs (e.g., `"server-1"`), requiring bidirectional request handling.

### 2. Session Object Structure (from session/list)

```json
{
  "createdAt": 1786958961514,
  "mode": "build",
  "traceId": "2078c217-24a3-4e94-888b-d9961bb9def9",
  "sessionId": "sess_631c7b65-1e29-41f3-85f0-43e205423652",
  "sessionKind": "interactive",
  "status": "idle",
  "title": "Launch Parallel Sub-Agents for Integration Plan",
  "titleSource": "generated",
  "updatedAt": 1786959066099,
  "workspace": {
    "workspaceKey": "/Users/azrael/workspaces/cloudcli",
    "workspacePath": "/Users/azrael/workspaces/cloudcli"
  }
}
```

**Field Names:**
- `sessionId` (not `session_id`)  
- `workspacePath` and `workspaceKey` (nested in `workspace` object)
- `status` values include: `idle`, `active` (inferred)
- `mode` values include: `build` (others expected: `plan`, `edit`, `yolo`)

### 3. Request Parameter Structures

#### session/create
```json
{
  "workspace": {
    "workspaceKey": "cloudcli", 
    "workspacePath": "/path/to/workspace"
  },
  "mode": "yolo"
}
```

#### session/subscribe  
```json
{
  "sessionId": "sess_...",
  "deliveryKind": "desktop-continuous" // Required: "desktop-continuous" | "web-remote-replayable"
}
```

#### session/send
```json
{
  "sessionId": "sess_...",
  "content": "echo hello" // Note: "content", not "message"
}
```

### 4. Error Codes

- `-32004`: Session is not active
- `-32600`: Invalid message (zod validation errors)
- `-32601`: Method not found

**Error Format:**
```json
{
  "code": -32004,
  "message": "Session is not active: sess_...",
  "data": {} // Optional additional error data
}
```

### 5. Server-to-Client Requests

**Discovered Method:** `session/requestRuntimePreferences`

```json
{
  "id": "server-1", 
  "method": "session/requestRuntimePreferences",
  "params": {
    "sessionId": "sess_...",
    "scope": "runtime-materialization"
  }
}
```

**Client Response Structure:**
```json
{
  "id": "server-1",
  "result": {
    "nativeSearchEnhancementsEnabled": false
    // Additional runtime preferences as discovered
  }
}
```

---

## Implementation Blockers & Solutions

### 🔴 Blocker 1: Model Configuration Requirement

**Issue:** Session creation fails with "Model config is missing" error without proper `~/.zcode/cli/config.json` setup.

**Error:** 
```
Model config is missing. Create /Users/azrael/.zcode/cli/config.json with an explicit model provider before running ZCode.
```

**Solution Path:**
1. Check for existing config during provider initialization
2. Guide users to create config if missing
3. Provide fallback to copy from `~/.zcode/v2/config.json`
4. Consider programmatic config creation for first-time setup

**Required Config Structure** (based on error analysis):
```json
{
  "model": {
    "providerId": "builtin:bigmodel-coding-plan",
    "modelId": "GLM-5.3"
  }
}
```

#### 2026-08-18 update: root cause found — config.json is a red herring in app-server mode

Validated against engine 0.16.3 with direct experiments (see "Headless bootstrap
recipe" below): a raw `node zcode.cjs app-server` subprocess **never reads
`~/.zcode/cli/config.json`**. Invalid JSON in that file produces the same
"Model config is missing" error as a valid file — the desktop app supplies
model config in-process instead. Filling in config.json (any shape, including
the one above) does NOT unblock headless session creation.

**Headless bootstrap recipe (validated):** before the first `session/create`,
the client must populate the engine's per-workspace model registry:

1. `workspace/upsertModelProvider` — `{ workspace, provider: { providerId,
   kind: "openai-compatible", apiFormat: "openai-chat-completions",
   baseURL: "https://open.bigmodel.cn/api/coding/paas/v4",
   apiKey: <see auth note>, source: "custom",
   models: [{ modelId: "GLM-5.3", supportsTools: true }] } }`
   (`apiKey` is a discriminated union: `{source:"inline",value}`,
   `{source:"env",name}`, `{source:"credential",key}`, or
   `{source:"server-config",key}`.)
2. `workspace/setDefaultModel` — `{ workspace, model: { providerId, modelId } }`
3. `session/create` now succeeds (response shape: `result.session.sessionId`;
   the id is NOT at the top level).

**Auth note (open problem):** `{source:"credential",
key:"oauth:bigmodel:access_token"}` resolves to nothing in a headless
subprocess — the shared store `~/.zcode/v2/credentials.json` holds `enc:v1:`
AES-256-GCM values keyed by `ZCODE_CREDENTIAL_SECRET` (fallback derivation
`sha256("zcode-credential-fallback:<platform>:<homedir>:<username>")` does NOT
decrypt desktop-written values; the desktop passes its own secret to its child
processes). `{source:"inline"}` with a real API key reaches the endpoint
correctly (a garbage value yields provider 401 "令牌已过期或验证不正确"),
so the API-key path works once a key is available. The engine's
`interaction/requestProviderRuntimeHeaders` server→client request is how the
desktop injects per-request auth headers and is a further option for OAuth
relay.

**Related protocol facts confirmed the same day:**
- `session/send` rejects `deliveryKind` (strict schema, `Unrecognized key`).
- Event stream types observed live: `session.titleUpdated`, `turn.started`,
  `session.updated`, `turn.failed` (payload.error.attribution carries
  statusCode/providerErrorCode). `turn.failed` currently maps to nothing in
  the sessions normalizer and should surface as `kind: 'error'`.

### 🟡 Blocker 2: Inactive Session State

**Issue:** Operations on inactive sessions fail with "Session is not active" errors.

**Impact:** Cannot test event streaming or message sending on completed sessions.

**Solution Path:**
- Implement session resumption logic
- Use `session/create` for new conversations 
- Handle session lifecycle states properly
- Consider session status filtering in UI

---

## Protocol Deviations from Integration Plan

### Discovered Mismatches

1. **Parameter Names:**
   - ❌ Assumed: `workspacePath` (top level)
   - ✅ Actual: `workspace.workspacePath` (nested)
   - ❌ Assumed: `message` (for content)
   - ✅ Actual: `content`

2. **Session State:**
   - ❌ Assumed: All listed sessions are active
   - ✅ Actual: Sessions have `idle`/`active` states requiring lifecycle management

3. **Bidirectional Protocol:**
   - ❌ Assumed: Simple request/response
   - ✅ Actual: Server can initiate requests (e.g., `session/requestRuntimePreferences`)

4. **Required Parameters:**
   - ❌ Assumed: Optional `deliveryKind` for subscription
   - ✅ Actual: Required enum field

---

## Field Names for Message Normalization

Based on integration plan §4 requirements:

### Stream Delta Events
*Not yet captured - needs active session testing, but expected structure:*
```json
{
  "type": "stream_delta",
  "params": {
    "sessionId": "sess_...",
    "content": "text chunk",
    "index": 0,
    "isEndOfSequence": false
  }
}
```

### Tool Use/Tool Result Structures  
*Not yet captured - needs active session testing, but expected based on SQLite schema:*
```json
// Tool Use
{
  "type": "tool_use", 
  "params": {
    "toolName": "Bash",
    "toolInput": {"command": "..."},
    "toolId": "tool_..."
  }
}

// Tool Result  
{
  "type": "tool_result",
  "params": {
    "toolResult": {
      "content": "output",
      "isError": false
    },
    "toolId": "tool_..."
  }
}
```

### Run Completion Events
*Expected based on integration plan analysis:*
```json
{
  "type": "run_complete",
  "params": {
    "sessionId": "sess_...",
    "tokens": {
      "input": 1234,
      "output": 5678, 
      "reasoning": 890,
      "cache": 100
    },
    "cost": 0.0123
  }
}
```

---

## Recommended Implementation Adjustments

### For zcode-protocol.client.ts

1. **Bidirectional Request Handler:**
   ```typescript
   handleServerRequest(message: ServerRequest): void {
     switch (message.method) {
       case 'session/requestRuntimePreferences':
         this.respondToServer(message.id, {
           nativeSearchEnhancementsEnabled: false
         });
         break;
       // Additional server request handlers
     }
   }
   ```

2. **Parameter Structure Corrections:**
   - Use `workspace.workspacePath` instead of `workspacePath`
   - Use `content` instead of `message` for user messages
   - Include `deliveryKind` in subscription requests

3. **Session Lifecycle Management:**
   - Check session status before operations
   - Handle inactive session errors gracefully
   - Implement session creation/resumption logic

### For zcode-auth.provider.ts

1. **Config Validation:** Check for model config during `getStatus()`
2. **Setup Guidance:** Provide clear user messaging for config setup
3. **Migration Support:** Offer to copy from v2 config if CLI config missing

---

## Event Types Discovered

### Server Requests (Bidirectional)
- `session/requestRuntimePreferences` - Client must respond with runtime preferences

### Client Methods (Successful)
- `session/list` - Lists all sessions with metadata

### Client Methods (Validated but Failed on Inactive Session)
- `session/subscribe` - Requires active session + deliveryKind parameter  
- `session/send` - Requires active session + content parameter
- `session/close` - Requires active session

### Expected Event Types (Not Yet Captured)
Based on integration plan and protocol structure:
- `session/event` - Main event streaming notification
- `stream_delta` - Text streaming chunks
- `tool_use` - Tool invocation notifications  
- `tool_result` - Tool execution results
- `run_complete` - Session turn completion with token data

---

## Next Steps for Phase 0 Completion

### Immediate (Phase 0.2 - Authentication)
1. **Test Authentication Flow:** Validate login credential requirements
2. **Config Setup:** Implement proper model configuration handling
3. **Active Session Testing:** Create/resume active session for event capture

### Phase 0.3 (Token & Event Structure)  
1. **Live Event Capture:** Run full conversation on active session
2. **Event Structure Mapping:** Document exact field names for all event types
3. **Token Data Validation:** Confirm token usage fields in completion events

---

## Files Created

1. **Validation Script:** `/Users/azrael/workspaces/cloudcli/scripts/zcode-phase0-1-validation.js`
2. **Event Samples:** `/Users/azrael/workspaces/cloudcli/scripts/zcode-event-samples.json`
3. **This Findings Report:** `/Users/azrael/workspaces/cloudcli/docs/phase0-1-findings.md`

---

## Conclusion

Phase 0.1 validation has successfully confirmed the viability of the app-server protocol approach and revealed critical implementation details that will significantly accelerate development. The discovered bidirectional protocol structure and exact parameter names will prevent significant debugging time during implementation.

**Status:** ✅ **READY FOR PHASE 0.2** (Authentication validation)  

**Confidence Level:** High - Protocol is stable and well-structured. Minor parameter name adjustments needed from integration plan assumptions, but core architecture validated.