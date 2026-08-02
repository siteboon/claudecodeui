# Cloud Control Plane + Multi-Machine Workers

> Branch: `feat/cloud-control-plane-workers`  
> Status: Phase 2/3 routed chat + control-plane decoupling in progress  
> Last updated: 2026-08-02

## Goal

Deploy a **cloud Server** (web UI / control plane) that manages and chats with **independent Agents on multiple machines**. Each machine runs a **Worker** that executes local CLIs (Claude / Cursor / Codex / OpenCode).

**Hard requirement:** web chat and native CLI on the Worker machine must stay in sync. After chatting on the web, the user must be able to go to that Worker machine and `resume` the same session with native `cursor` / `codex` / Claude CLI. Cloud history alone is not enough.

Not in scope for v1: remote file tree, remote Git, remote Shell/PTY.

## Current reality (important — do not mis-test)

Set `CONTROL_PLANE=1` on the Server (alias: `DISABLE_SESSION_WATCHERS=1`).

```text
控制面模式 (CONTROL_PLANE=1):
  Browser → Server /ws → Worker WS chat.run → Worker 本机 providerRuntime
  Server: 不跑 CLI、不扫 ~/.cursor|~/.codex、历史只读 session_messages
  新建会话必须带 machineId

未开控制面（旧单体兼容）:
  仍可 Server 本机 runtime + 本机 transcript watcher
```

Same-box Server+Worker is OK for smoke tests **if** Worker logs show `chat.run`. Cross-host E2E remains the gold standard for Phase 4.

## Product decisions (locked)

| Decision | Choice |
|---|---|
| Workspace model | **A — Independent per machine**. No shared task queue across machines. |
| Session truth | **Dual-write**: Server stores canonical web history; Worker keeps **native provider files** so local CLI can resume. |
| Local delete | Cloud history remains for web reopen/continue. |
| Native CLI resume after web chat | **Required in v1** (same Worker machine). Must sync / keep provider artifacts usable for resume. |
| Restore native files after local wipe | **In scope with chat routing** (Server → Worker rewrite or replay into provider-native store). |
| IDE-like panels (files / Git / shell) | **Out of v1** on the cloud UI path. |
| TLS | Production uses **HTTPS + WSS** via reverse proxy; Node listens on localhost. |

## Target architecture

```text
Browser
  │  https://  +  wss://
  ▼
Reverse proxy (Caddy / Nginx / cloud LB)  ← TLS terminates here
  │  http://127.0.0.1:3001
  ▼
Server (control plane)
  - static web UI
  - auth / API
  - machine registry
  - session + message DB (cloud copy / web source of truth)
  - chat WS hub (browser ↔ route to worker)   ← NOT in-process providerRuntime
  ▲
  │  wss:// (workers dial out; NAT-friendly)
  │
  ├── Worker@machine-1  → local Claude/Cursor/Codex + native transcript files
  ├── Worker@machine-2
  └── Worker@machine-N
```

### Responsibility split

| Concern | Server | Worker |
|---|---|---|
| Web UI | Yes | No |
| User auth | Yes | No |
| Machine register / heartbeat / online | Yes | Connect + heartbeat |
| Session list / open history (web) | Persist + serve | Report / stream events |
| Message persistence (cloud) | Persist | Stream events up |
| Native provider transcripts (CLI resume) | May push restore payloads | Own `~/.claude` / `~/.cursor` / `~/.codex` … |
| Run / abort agent | Dispatch by `machine_id` | Execute local provider runtime |
| Provider credentials / local CLI install | No | Yes (on that machine) |
| File tree / Git / PTY | Deferred | Local only for now |

## Install shape (post-MVP packaging)

Prefer Git install first (no public npm required). One repo, two commands for now; split packages later if needed.

```bash
# Cloud server
npm run build && npm run server

# Each agent machine
node dist-server/server/modules/cli/cli.js worker start \
  --server wss://agents.example.com \
  --token <machine-token>
```

Notes:

- Server process should **not** require Claude/Cursor CLI on the cloud host once chat is Worker-routed.
- Worker should **not** need the web UI bundle.
- Do **not** expose Node `:3001` publicly; only the reverse proxy.

## HTTPS / WSS requirements

1. Browser → Server: `https` + `wss` (mandatory in production).
2. Worker → Server: `wss` with machine token (mandatory in production).
3. Proxy must support WebSocket upgrade and long-lived connections (chat can run a long time).
4. Frontend already selects `wss` when the page is `https`; keep that invariant.
5. Dev may stay on `http`/`ws`; production config forces TLS URLs.

## Data model (minimal)

### `machines`

- `id`, `name`, `token_hash`, `status` (`online`/`offline`), `last_seen_at`, `created_at`
- Optional: hostname, labels, supported providers

### `sessions` (extend existing concept)

- Keep app session id as the ID the UI knows
- Add `machine_id` (required for routed chat)
- Keep `provider`, project path (machine-local path), titles, timestamps
- Provider-native session id remains a mapping field when available

### `messages` (or equivalent event log)

- Store normalized chat messages / envelopes needed to render history on the web
- Enough to reopen a session after local deletion
- Streaming live path still uses WS; persistence is durable cloud copy

### Native sync artifacts

- Worker reports provider-native session ids + paths after runs
- Server can request Worker to ensure local resume files exist (write-back / replay) when web continues a session whose local files are missing
- Success means: on that Worker, native CLI `resume` sees the same conversation

## Protocol sketch (Worker ↔ Server)

Transport: Worker outbound WebSocket (production: `wss`).

**Worker → Server**

- `worker.hello` — auth with machine token, advertise capabilities
- `worker.heartbeat`
- `worker.session_upsert` — local session metadata / native id mapping
- `worker.event` — normalized chat events for an app session (`seq`, payload)
- `worker.run_complete` / errors

**Server → Worker**

- `worker.welcome` — assigned machine id / server features
- `chat.run` — start or continue a run (`sessionId`, provider, prompt, options)
- `chat.abort`
- `chat.permission_response`
- `session.ensure_native` — ensure local provider files exist for resume (sync/write-back)

Browser continues to speak the existing app chat WS protocol to Server; Server routes runs to the correct Worker by `session.machine_id` / explicit machine selection on new chats.

## Phased plan

### Phase 0 — Branch & planning

- [x] Branch: `feat/cloud-control-plane-workers`
- [x] This plan (`plan.md`)
- [ ] Keep `main` aligned with upstream/fork sync; merge `main` into this branch regularly

### Phase 1 — Machine registry + Worker tunnel (no real agent yet) ✅

- [x] Server module `machines` (register, list, revoke token, online state)
- [x] Worker process entry (`cloudcli worker start`)
- [x] Outbound WS connect + token auth + heartbeat
- [x] Echo / ping path
- [x] Minimal UI: machine list + online indicator

**Exit criteria met:** browser sees online machines; Worker reconnects; Ping works.  
**Explicitly NOT done:** chat still uses Server-local providerRuntime.

### Phase 2 — Cloud session store + machine binding

- [x] Persist sessions with `machine_id`
- [x] Persist message/event history on Server
- [x] UI: per-machine session list, open history from cloud (machine picker + `selected-machine-id`)
- [x] Stop treating “same box Server+Worker” as proof of routed chat

**Exit criteria:** web can list/open sessions by machine from Server DB.

### Phase 3 — Routed chat **and** native sync (together — required)

Do these as one milestone; do not ship web-only history without native resume on the Worker.

- [x] New chat: pick machine + provider
- [x] Server `/ws` `chat.send` dispatches `chat.run` to that Worker (no in-process runtime on Server)
- [x] Worker runs local provider runtime; streams events up; Server fans out + persists
- [x] Abort + permission approval round-trip via Server
- [x] **Native sync:** Worker leaves provider-native artifacts such that `cursor` / `codex` / Claude CLI on that machine can resume the same session (run-local + path report)
- [x] **Write-back:** if local native files are missing but cloud history exists, Server asks Worker to restore/replay enough for native resume before continuing (Claude/Codex jsonl rewrite; Cursor drops native id and starts fresh)
- [ ] Verification matrix: web chat on Worker A → native resume on Worker A works; Worker B does not see A’s native files (independent machines)

**Exit criteria:**

1. Chat packets clearly go Worker WS (not Server-local runtime).
2. Same session resume works with native CLI **on that Worker**.
3. Cloud UI still shows history if local files were deleted, and can restore native resume after write-back.

### Phase 4 — Hardening

- [ ] Reliable reconnect + event replay / catch-up
- [ ] Worker offline UX
- [ ] Token rotation, basic audit logs
- [ ] systemd/pm2 examples; Caddy/Nginx sample for HTTPS+WSS
- [ ] Packaging: `server` / `worker` commands
- [ ] Test rule: Server host ≠ Worker host for chat E2E

### Phase 5 — Optional later

- [ ] Remote file tree / Git / Shell via Worker RPC
- [ ] Bulk import of pre-existing local provider histories
- [ ] Split npm packages `@scope/cloudcli-server` / `@scope/cloudcli-worker`

## Mapping onto this repo

Existing strengths to reuse:

- Provider interfaces (`IProviderRuntime`, sessions, normalized messages)
- Chat WS envelope / `seq` / subscribe model
- Auth patterns for browser users
- Module layout under `server/modules/*`

Likely new / changed areas:

- `server/modules/machines/` — registry + tokens + presence ✅
- `server/modules/worker-gateway/` — Worker WS protocol ✅ (ping only so far)
- Session/message persistence with `machine_id`
- `providerRuntimeService` / chat handler — dispatch to Worker instead of in-process run
- Native sync/write-back helpers per provider on Worker
- CLI entry — `worker start` ✅; keep Server start as today
- Frontend — machine picker + filter sessions by machine

## Sync / merge workflow

```bash
git checkout main
git pull origin main

git checkout feat/cloud-control-plane-workers
git merge main
```

## Install from Git (no npm publish)

See `README.zh-CN.md` / `README.md` section **多机控制面 / Multi-machine control plane**.

## Non-goals / exclusions (v1)

- Turning the cloud UI into a full remote IDE
- Requiring inbound ports to worker machines
- Storing raw provider credentials on the Server
- Cross-machine native resume (session created on Worker A, resume files expected on Worker B) — out of scope under model A

## Success definition (v1)

1. Server deployed behind HTTPS.
2. N workers on different machines connect with tokens over WSS.
3. Web UI lists machines and their sessions independently.
4. User chats via web → Server routes to chosen Worker (proven, not same-box illusion).
5. Cloud keeps message history if local files disappear.
6. **On that Worker, native Claude/Cursor/Codex CLI can resume the web-created session** after sync/write-back.
