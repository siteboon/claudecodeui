# claudecodeui-dev sbx kit

A [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) `kind: mixin` kit
that runs **this checkout's source** (not the published `@cloudcli-ai/cloudcli`
package) inside a sandbox. Use it to develop/test claudecodeui itself in a
clean, disposable Linux environment instead of on the host.

It installs `build-essential`/`python3` (needed to compile the native
modules: `better-sqlite3`, `node-pty`, `bcrypt`), then on every container
start runs `npm install`, rebuilds those native modules for the sandbox's
platform, and launches `npm run dev` in the background.

## Why the rebuild step

The workspace is bind-mounted, not copied, so a `node_modules` already built
on the host (macOS/other arch) is visible inside the Linux sandbox too.
Native `.node` binaries are not portable across platforms, so the kit forces
a rebuild inside the sandbox on every start. The reverse is also true: after
using this kit, native modules in `node_modules` will be Linux binaries and
won't load if you go back to running `npm run dev` directly on the host
until you `npm rebuild` there again.

## Permissions default

The kit sets `CLOUDCLI_DEFAULT_CLAUDE_SKIP_PERMISSIONS=true` in the
container's environment. `server/modules/auth/auth.module.ts` reads that at
startup and, only at the moment the sandbox's one user account is first
registered through the web UI, seeds their `claudePermissions` preference
with `skipPermissions: true` — matching the sandbox's own interactive
`claude` agent, which already runs with `--dangerously-skip-permissions`.
Without this, every tool call in a web-UI chat session prompts for approval,
since the app's default permission mode is independent of that CLI flag.

This only affects the one-time account creation; it never touches an
existing account's settings. To go back to the historical ask-every-time
default, remove the `CLOUDCLI_DEFAULT_CLAUDE_SKIP_PERMISSIONS` line from
`spec.yaml`'s `environment.variables`.

## Auto-created admin account

The kit also sets `CLOUDCLI_AUTO_CREATE_ADMIN=true`. At boot, if no user
exists yet, the server creates one (username `admin`) with a randomly
generated password and prints it to stdout once. `ccui-sbx` reads it back
out of the sandbox and shows it in its startup summary — no need to open
the web UI and fill in the setup form before you can sign in. Like the
permissions default above, this never touches an existing account; a
sandbox that already had a user before this run simply won't print (or
find) a password.

This is meant for disposable, single-user dev sandboxes: the password is
printed once to a log a container operator can read, which trades a bit of
that for "nobody has to be watching a browser at the right moment." It is
not a production security posture — don't set `CLOUDCLI_AUTO_CREATE_ADMIN`
outside a throwaway sandbox. To turn it off, remove the
`CLOUDCLI_AUTO_CREATE_ADMIN` line from `spec.yaml`'s `environment.variables`
and go back to registering manually through the web UI. `CLOUDCLI_ADMIN_USERNAME`
and `CLOUDCLI_ADMIN_PASSWORD` (set directly on the server process, not
currently exposed via this kit) override the generated username/password
if you need a fixed value instead.

## Usage

### Option A: `ccui-sbx` launcher (recommended)

[`bin/ccui-sbx`](bin/ccui-sbx) is a thin wrapper around `sbx run claude` that
attaches this kit and publishes both ports automatically. Every other
argument is forwarded to `sbx run` untouched, so it takes all the normal
`sbx run` flags (`--name`, `--env`, `--clone`, `-- AGENT_ARGS`, etc).

It creates the sandbox **headless** (`--detached`) by default: the claude
TUI never takes over your terminal, so the actual published ports (which
can differ from 3001/5173 if those are already busy — see below) stay
visible in a summary printed once the sandbox is up. On a fresh sandbox it
waits (up to ~60s) for first-time setup — `npm install` plus the native
module rebuild — to finish and print the generated admin password before
showing that summary:

```
── ccui-sbx: 'ccui-claudecodeui' is running headless ──
  Web UI / API:  http://127.0.0.1:49158
  Vite (HMR):    http://127.0.0.1:49159

  Admin login:   admin / 3f1a9c2e8b7d4f0a1e6c5b3a9d8f7e2c

  Attach to the claude agent:   sbx run --name ccui-claudecodeui
  Tail the dev server logs:    sbx exec ccui-claudecodeui bash -lc 'tail -f /tmp/claudecodeui-dev.log'
  Stop it:                     sbx stop ccui-claudecodeui
```

Set `CCUI_SBX_ATTACH=1` to get the old behavior instead: attach to the
interactive claude session immediately after creation.

Install it once, from the repo root:

```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/docker/sbx-kit/bin/ccui-sbx" ~/.local/bin/ccui-sbx
```

Make sure `~/.local/bin` is on your `PATH`, then run it from anywhere:

```bash
ccui-sbx                          # mount $PWD as the workspace
ccui-sbx ~/repos/claudecodeui     # mount a specific checkout
ccui-sbx . --name ccui-dev        # any normal sbx run flag works
```

The kit is resolved from the symlink's real target, so it always uses the
kit shipped in the checkout you installed from — regardless of which
directory you're in or which checkout you point it at.

Override the published host ports (container ports stay 3001/5173) or skip
the kit entirely with env vars:

```bash
CCUI_SBX_SERVER_PORT=13001 CCUI_SBX_CLIENT_PORT=15173 ccui-sbx .   # force specific host ports
CCUI_SBX_NO_KIT=1 ccui-sbx .                                       # plain claude sandbox, ports only
CCUI_SBX_ATTACH=1 ccui-sbx .                                       # attach to claude interactively
```

If a default or forced host port is already taken, `ccui-sbx` doesn't fail
the launch — it lets `sbx` allocate an ephemeral port instead and reports
whatever port actually got used in the summary above.

### Option B: raw `sbx run`/`sbx create`

```bash
sbx create shell . --name ccui-dev --kit ./docker/sbx-kit
# or with the claude agent instead of a bare shell:
sbx create claude . --name ccui-dev --kit ./docker/sbx-kit

# open the ports the dev server needs
sbx ports ccui-dev --publish 3001:3001   # API / web UI
sbx ports ccui-dev --publish 5173:5173   # Vite client (HMR)
```

Then open http://localhost:3001.

Logs inside the sandbox:

```bash
sbx exec ccui-dev bash -lc 'tail -f /tmp/claudecodeui-install.log /tmp/claudecodeui-dev.log'
```

Note: `commands.startup` kits can only be applied at sandbox creation time
(`sbx create --kit` / `sbx run --kit`) — `sbx kit add` on an existing
sandbox is not supported for kits that declare startup commands.
