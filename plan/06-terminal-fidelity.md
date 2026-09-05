# 06 — Terminal fidelity in the Shell tab

**Status:** OPEN · **Depends on:** nothing · **Independent**
**Findings:** O19–O21 · **Upstream:** unclaimed

Reported symptom: scroll is unstable and jumps several rows at a time; sessions
started from the Shell tab warn `Transcript saving is off — inherited
CLAUDE_CODE_CHILD_SESSION marker`.

Three separate causes, in increasing order of effort.

## O19 — `convertEol: true` on a PTY source (1-line fix)

`TERMINAL_OPTIONS.convertEol = true` at `src/modules/shell/hooks/useShellTerminal.ts:25`.

xterm's own typings (`@xterm/xterm/typings/xterm.d.ts:56`) say:

> *"Normally the termios settings of the underlying PTY deals with the
> translation of '\n' to '\r\n' and **this setting should not be used**. If you
> deal with data from a **non-PTY** related source, this setting might be
> useful."*

Our source **is** a PTY (`node-pty`), so this is double EOL translation: xterm's
idea of the current line desynchronises from the absolute cursor addressing the
Claude Code TUI emits. That is the row-jumping.

**Fix:** `convertEol: false`. Test before anything else here — it is the
cheapest experiment in the file and may be the whole bug.

## O20 — reattach replays a byte log instead of screen state

`shell-websocket.service.ts:437` keeps up to 5000 raw output chunks per held PTY
and replays all of them on reconnect (`:365`). For a full-screen TUI, replaying
cursor-addressing escapes out of context — possibly into a terminal of a
different size — cannot reconstruct the screen. It renders as garbage and jumps.

This is a state-vs-log replay problem: a byte log is not a snapshot.

**Fix options:**

- **Cheap:** on reattach, don't replay; ask the TUI to repaint (`Ctrl-L`
  equivalent) or clear and let the next frame redraw. Loses scrollback.
- **Proper:** back the PTY with tmux (below), which owns the screen and sends a
  coherent redraw on attach. The 5000-chunk buffer can then be deleted outright.

## O21 — `CLAUDE_CODE_CHILD_SESSION` is frozen into the pm2 dump

`~/.pm2/dump.pm2` contains `"CLAUDE_CODE_CHILD_SESSION": "1"`, written
**2026-08-25 19:38** by a `pm2 save` that ran from inside a Claude Code session.
`pm2 resurrect` at boot replays that dump verbatim, so the marker survives
reboots — the host booted 2026-09-04 11:22:26 and the app inherited it anyway.
Proof it is a fossil: the env still carries `CLAUDE_PID=1972065` (dead) and
`AI_AGENT=claude-code_2-1-233_agent` (an older CLI than the one installed).

The PTY spawn passes `...process.env` verbatim
(`shell-websocket.service.ts:413`), so every `claude` started from the Shell tab
inherits it, believes it is a child session, and **writes no transcript** — no
`~/.claude/projects/**.jsonl`, so it cannot be resumed and never appears in
history. SDK chat sessions are unaffected (this session's transcript exists), so
the damage is confined to the Shell tab.

The CLI's own check (from the 2.1.261 bundle) makes the cheap fix safe —
`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` is tested **first** and short-circuits
the whole child-session branch, and it is a truthiness test, so any non-empty
value works:

```js
function kTe(){
  if (a.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE) return !1;
  if (!(a.CLAUDE_CODE_CHILD_SESSION && id() && !Zi())) return !1;
  ...
}
```

**Fix, three options:**

0. **One line in `~/.cloudcli/ecosystem.config.js`**, then reload:
   `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: 1` in the `env` block, then
   `pm2 restart ~/.cloudcli/ecosystem.config.js --update-env && pm2 save`.
   `--update-env` is required — a plain `pm2 restart cloudcli` replays the saved
   env and never re-reads the config. `pm2 save` rewrites the dump so it
   survives the next boot. This fixes the symptom but leaves the fossils
   (`CLAUDE_PID`, `AI_AGENT`, `CLAUDE_CODE_MESSAGING_SOCKET` pointing at a dead
   socket, `CLAUDE_CODE_SSE_PORT`) in place.

1. **Or** re-create the pm2 app from a clean environment, from a plain SSH shell —
   **not** from inside a Claude session, and note that it kills any live session:

   ```bash
   pm2 delete cloudcli
   env -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID \
       -u CLAUDECODE -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN \
       -u CLAUDE_CODE_SSE_PORT -u CLAUDE_CODE_ENTRYPOINT -u AI_AGENT \
     pm2 start ~/.cloudcli/ecosystem.config.js && pm2 save
   ```

2. In code, strip the inherited markers at the PTY spawn site so it cannot
   recur, or set `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` there.

## Optional — tmux as the PTY backend

Replaces `pty.spawn('bash', ['-c', cmd])` (`shell-websocket.service.ts:409`)
with `tmux new-session -A -s <key> -c <cwd> <cmd>`. Verified on tmux 3.4: `-A`
attaches to an existing session instead of creating a duplicate, so
restore-on-reopen is one command.

**Buys:** sessions survive `pm2 restart` / crash / cloudcli update; correct
redraw on attach (fixes O20 and deletes the buffer); attachable from SSH and
from the existing `tmux-ide` layouts; no 30-minute timeout to tune.

**Costs:** an extra layer to debug; prefix-key collisions unless launched with a
dedicated config that binds nothing (`tmux -f <conf>` + `unbind-key -a`);
multi-client resize needs `attach -d` or `set -g window-size latest`; no Windows
path, so the current spawn stays as fallback. Does **not** survive reboot on its
own — that still needs `claude --resume`.

**Decide by:** whether `pm2 restart cloudcli` should stop killing live sessions.
If yes, tmux earns its place; if the only goal is reopening a tab, the existing
held PTY plus the O20 fix is enough.

## Verification

1. `convertEol: false`, run a long Claude TUI session, scroll during output.
2. Disconnect and reattach mid-render; confirm the screen is coherent.
3. `claude` from the Shell tab, then check a new `.jsonl` appears under
   `~/.claude/projects/<cwd>/` — that is O21 fixed.
4. Resize the browser window during a render; confirm no permanent corruption.
