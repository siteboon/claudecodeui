# Continue interrupted turns after deployment

Self-hosted deployments can opt into automatic continuation using
`scripts/deployment-recovery.mjs`. The deployment worker captures the sessions
currently running before stopping CloudCLI, then sends a single `continue`
message to each captured session after the replacement server is healthy.
Idle sessions, independent Claude CLI processes, and background-only tasks are
excluded. This tool does not build releases or manage your service manager.

## Deployment integration

Run the worker as the same OS user that owns CloudCLI, with access to its local
database and provider credentials. Use an absolute snapshot path in a private,
durable directory, with a new filename and deployment id for every deployment.

```sh
# In the installed CloudCLI package or repository:
node scripts/deployment-recovery.mjs snapshot release-2026-10-02 /var/lib/cloudcli/recovery/release-2026-10-02.json

# Your deployment worker stops the old server, promotes the prepared build,
# starts the replacement, and waits for stable health here.

node scripts/deployment-recovery.mjs resume /var/lib/cloudcli/recovery/release-2026-10-02.json
```

The equivalent npm commands are `npm run deployment:recover -- snapshot ...`
and `npm run deployment:recover -- resume ...`.

Create the snapshot as the last step before stopping the old server. Abort the
deployment if snapshot capture fails: a session whose provider id has not been
initialized cannot safely resume. Never reconstruct running sessions from
transcript timestamps. If a graceful drain completes some turns, capture again
with a new snapshot immediately before the actual stop; do not resume turns
that finished during the drain. Avoid admitting new turns between capture and
stop. Capture/stop is not an atomic server operation, so a turn can still finish
in that short interval.

If the deployment was requested from a hosted agent conversation, run the
deployment worker **outside the CloudCLI service's process group/cgroup**.
Stopping that service also kills an agent or worker hosted inside it. For
example, run your complete deployment script as a separate systemd user unit:

```sh
systemd-run --user --collect --no-block --unit=cloudcli-deploy-release-2026-10-02 /absolute/path/to/deploy-worker.sh
```

Only call `resume` after the selected release passes your stable-health and
smoke checks. Its own `/health` check is an additional guard, not a substitute
for release validation. A recovery failure should be reported separately from
deployment health; do not roll back a healthy server merely because an agent
cannot resume. The continuation can also be sent after a healthy rollback.

## Configuration and authentication

The tool reads `.env` from the installation root, then overlays the worker's
environment. Defaults:

| Setting | Default |
| --- | --- |
| `CLOUDCLI_RECOVERY_APP_ROOT` | Parent of the `scripts` directory |
| `CLOUDCLI_RECOVERY_HTTP_URL` | `http://127.0.0.1:${SERVER_PORT}`, port 3001 if unset |
| `DATABASE_PATH` | `~/.cloudcli/auth.db`; relative paths resolve against the installation root |

`CLOUDCLI_RECOVERY_HTTP_URL` must be a loopback HTTP(S) origin, with no URL
credentials, query, or path prefix. Keep the worker on the same host as its
database and server. HTTP redirects are rejected. If you promote into a new
installation directory, set `CLOUDCLI_RECOVERY_APP_ROOT` to that installation
when resuming, and point `DATABASE_PATH` at the same persistent database.

The tool opens SQLite read-only and signs a ten-minute JWT for the first active
local user using `JWT_SECRET` or the stored installation secret. In platform
mode (`VITE_IS_PLATFORM=true`), it uses the existing platform authentication
behavior. `API_KEY`, when configured, is sent in request headers. Credentials
are never saved in the snapshot or journal. These files are written atomically
with mode 0600; directories created by the tool use mode 0700.

## What the continued turn receives

Recovery uses the existing app session id and verifies the captured provider
mapping still exists after deployment. It preserves the session's saved model
and reasoning effort, including custom model ids. Attachments and earlier
prompts are not replayed. The provider's default permission behavior applies;
the tool never copies `skipPermissions`, bypass modes, or tool allowlists.
An approval may therefore require the user to return to that session.

The injected message tells the agent to continue from the existing state,
verify what already completed, and avoid repeating completed side effects. It
includes the deployment id. This is a new provider turn in the same transcript;
it cannot restore in-memory tool state or guarantee arbitrary side effects
were exactly once.

## Status, retries, and interrupted workers

Each snapshot has one fixed journal (`<snapshot>.status.json`) and lock
(`<snapshot>.lock`). Always reuse the original snapshot path when resuming.
Do not copy snapshots to create fresh journals: that bypasses duplicate
protection. Existing snapshot files cannot be overwritten by `snapshot`.

Before every `chat.send`, the worker durably records `dispatching`. Repeating
`resume` skips every recorded attempt, even if the resumed turn already
finished. An already-running session is recorded without sending anything.
Concurrent workers are rejected by the exclusive lock. A journal is bound to
its snapshot by a SHA-256 fingerprint; editing the snapshot causes recovery
to fail rather than resetting its history.

| Per-session state | Meaning |
| --- | --- |
| `accepted` | The turn remained running through a one-second startup check, or completed successfully during that check |
| `already-running` | Another turn was active; no additional continuation was needed |
| `failed` | The server rejected the request or the provider failed during startup |
| `unconfirmed` | Connection/acknowledgment was lost, timed out, or an earlier worker stopped during dispatch |

Metadata and subscription receipts alone do not prove provider startup. The
command exits 0 for fully confirmed recovery or an empty snapshot, 1 for errors
or partial recovery, and 2 for incorrect command usage. `accepted` confirms
startup, not completion of the agent's whole task.

If a worker is killed, its lock may remain. Check the PID in the lock and verify
that worker has exited before removing the lock. The next `resume` converts a
leftover `dispatching` entry to `unconfirmed` and **does not resend it**. Inspect
the session history and actual effects before manually requesting another
turn. Only sessions without any recorded dispatch attempt remain eligible for
automatic recovery. Connection/health failures before dispatch can be retried
with the same snapshot.

## Tests

```sh
npm run test:deployment-recovery
```

The tests use a disposable SQLite database, real local HTTP/WebSocket servers,
and subprocess workers. They cover server restart, model/effort retention,
provider initialization/mapping guards, completed retries, concurrent workers,
worker death after dispatch, startup failure, unhealthy servers, and snapshot
tampering. They do not start a real model or interrupt a live CloudCLI service.
