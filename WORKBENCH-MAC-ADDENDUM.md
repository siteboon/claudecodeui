# Workbench — macOS Addendum

Adds macOS (MacBook, Apple Silicon) support to `WORKBENCH-PLAN.md`. If a phase is already done, apply the relevant items now; otherwise do them as part of the matching phase. Tick checkboxes and commit as you go.

**Deadline:** must run on the MacBook from Thursday. Priority: section 1 (blocking) → 2 → 3.

## Hard rule (extends the main plan's Hard rules)

Cross-platform, no exceptions. Never hardcode paths, shells, path separators or keyboard modifiers:

- use `path.join`, `os.homedir()` and `process.platform`
- use `CmdOrCtrl` for shortcuts
- replace any Windows-only code written so far with platform-branched code

All existing Hard rules still apply, including: no subscription tokens outside the official CLIs.

## Mac setup (Kevin does this once)

- Node.js LTS, Git, Xcode Command Line Tools (`xcode-select --install`, needed to build `node-pty`)
- Claude Code and Codex CLIs installed and logged in through their own login flows
- Clone the fork, `npm install`, then `@electron/rebuild` for node-pty

## 1. Blocking

- [ ] **PATH fix (most important).** Finder/Dock-launched apps don't inherit the shell PATH. At startup on macOS read the login-shell env once (`$SHELL -ilc env`, as `shell-env` / `fix-path` do) and merge its PATH into `process.env`, before spawning any CLI or git process. The Phase 1 "CLI missing" check runs after this fix.
- [ ] **PTY shell:** `$SHELL` (usually `/bin/zsh`) on macOS, PowerShell on Windows. Spawn CLIs directly with `spawn(cmd, args[])`, not shell strings.
- [ ] **Paths:** audit for `\\`, drive letters, `C:`/`D:` defaults, `.exe` suffixes, `cmd /c`. Branch by platform.
- [ ] **Build target:** electron-builder `mac` = `dmg` + `zip`, arch arm64. npm script `build:desktop:mac`. Build on the Mac itself (node-pty is native).
- [ ] **Unsigned app is fine.** Document first launch in `README-WORKBENCH.md`: right-click → Open, or `xattr -dr com.apple.quarantine /Applications/Workbench.app`.

## 2. Mac behaviour

- [ ] Standard macOS application menu (App / Edit / View / Window). Edit menu required for Cmd+C/V/A.
- [ ] Window lifecycle: closing last window keeps app running; Dock click reopens (`activate`); Cmd+Q quits and cleans up all PTYs.
- [ ] Tray → menu bar icon: monochrome template image (`...Template.png`), same menu as Windows.
- [ ] Shortcuts via `CmdOrCtrl`: Cmd+K palette, Cmd+Enter send, Cmd+Shift+Space focus prompt. Check for collisions with Wispr Flow's hotkey.
- [ ] Notifications: handle first-use permission and the denied state without errors.
- [ ] Start at login: `app.setLoginItemSettings` (works on Windows too).
- [ ] "Open in Explorer" → "Reveal in Finder" (`shell.showItemInFolder`). "Open in VS Code" uses `code` from fixed PATH, fallback `open -a "Visual Studio Code" <path>`.

## 3. Two machines — data stays per machine

- [ ] Machine-local, never synced: vault path, project roots, worktrees root, `.env` copy list. Mac defaults (confirm with Kevin on first run): project root `~/Programming`, vault = local clone of the Obsidian vault.
- [ ] Session DB stays local. Code moves between machines only via git push/pull.
- [ ] "Unpushed" badge on session branches with unpushed commits, plus a "Push branch" action.
- [ ] Hook install on Mac (Phase 2): Claude Code / Codex status hooks as a POSIX shell script instead of a Windows script. Consent and backup rules unchanged.

## Acceptance (Mac)

1. Build the dmg, install into `/Applications`, launch from Finder (not a terminal).
2. UI ready in under 5 seconds.
3. A Claude and a Codex session both start (proves the PATH fix).
4. Cmd+C / Cmd+V work in the prompt box.
5. Two parallel worktree sessions work, with status, diff and discard.
6. A dictated Wispr Flow prompt only sends on Cmd+Enter.
7. After Cmd+Q, no `claude` or `codex` processes remain in Activity Monitor.
8. The Windows build still passes its own acceptance checks.
