# Phase 0 follow-up + Phase 1 sub-plan

Decision (Kevin): replace the Agent SDK chat path with PTY-launched `claude` / `codex`, and remove credential-file parsing. Cross-platform rule from `WORKBENCH-MAC-ADDENDUM.md` applies to everything below.

## Phase 0b — Hard-rule cleanup (do first, own commits)

Scope facts: chat is wired end to end through `/ws` (`chat-websocket.service.ts`, `chat-run-registry.service.ts`) into `provider-runtime.service.ts` and the `claude-runtime` / `codex-runtime` providers. Scheduled messages and `/api/agent` also call the runtimes. The Shell tab already runs the real CLIs in a PTY (`shell-websocket.service.ts`).

1. **PTY becomes the only way to run an agent.**
   - Sessions open in the xterm Shell view (`src/modules/shell`). Chat composer / message list are hidden behind a build-time flag `WORKBENCH_PTY_ONLY=1` (default on) rather than deleted at first, to keep upstream merges small.
   - Remove runtime wiring: `chat.send|edit-send` handlers return a `protocol_error` ("disabled in Workbench"); `claude-runtime.provider.js`, `claude-fork.provider.ts`, `codex-runtime.provider.ts` no longer imported by the registry.
   - Remove dependencies `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`; drop their tests. Keep `@openai/codex` only if `codex-app-server.client.ts` is still needed (else remove).
   - Disable scheduled-messages dispatcher and `/api/agent` + `/api/browser-use-mcp` routes (unauthenticated, call runtimes).
   - Transcript viewing: keep the read-only JSONL session readers (`*-sessions.provider.ts`) so past sessions stay browsable.
2. **Remove credential parsing.**
   - `claude-auth.provider.ts`: delete `readCredentialsFile`, `loadSettingsEnv`, `subscriptionOverride`; `checkCredentials()` returns installed/not-installed via `claude --version` only.
   - `codex-auth.provider.ts`: delete `auth.json` read and JWT decode; same version check.
   - Opencode/cursor auth providers: same treatment or disable those providers.
   - Update `claude-auth.test.ts`; remove warning UI in `AccountContent.tsx` / `server/shared/types.ts`.
3. **Stop writing to tool configs.** Disable `claude-mcp` / `codex-mcp` write paths (`~/.claude.json`, `~/.codex/config.toml`); make session/project delete not touch transcript files (soft-delete in DB only); drop `~/.claude/external-projects` clone code with `/api/agent`.
4. **Bind localhost.** Default `HOST=127.0.0.1` in `server/index.ts`; Electron passes it explicitly.
5. **Credentials DB.** Remove GitHub-token store usage (plaintext) from clone/git routes; use system `git` auth.
6. **Verify:** `npm run typecheck`, `npm test`; grep for `credentials.json|auth.json|claude-agent-sdk|codex-sdk|ANTHROPIC_API_KEY` returns nothing outside tests/docs; manual: start `claude` and `codex` in Shell tab.

## Phase 1 — Desktop shell (adapt existing `electron/`)

Existing `electron/` already spawns the server as a child process, picks a port, waits for `/health`, and packages with electron-builder. Adapt, don't rewrite:

1. **Strip** cloud-account (`cloud.js`, `cloudcli://` deep link, `cloudcli.ai` calls), launcher/tabs UI if not needed, and "reuse running CloudCLI on 3001" behaviour. Always own the server: free random port, `HOST=127.0.0.1`.
2. **Window**: single BrowserWindow on server URL; persist bounds (`electron-window-state` or small JSON in userData).
3. **Single instance**: `app.requestSingleInstanceLock()` + focus on `second-instance`.
4. **Quit cleanup**: on `before-quit` signal server child; server kills all PTYs on SIGTERM; on Windows use `taskkill /T` fallback; verify no `claude`/`codex` left (Task Manager / Activity Monitor).
5. **Tray / menu-bar**: Open, active sessions count (poll `/api/...` or WS), Quit; `...Template.png` on macOS.
6. **Start with OS**: `app.setLoginItemSettings`, settings toggle, default off.
7. **Mac items (addendum §1–2)**: login-shell PATH fix before any spawn (`$SHELL -ilc env`), `$SHELL` for PTY, application menu with Edit, `window-all-closed` keeps app on mac, `activate` reopens, `CmdOrCtrl` shortcuts.
8. **Startup check** (after PATH fix): `claude` / `codex` missing → dialog with install instructions, app still opens.
9. **Packaging**: productName "Workbench", appId `local.workbench.desktop`; win NSIS + portable, mac dmg+zip arm64; scripts `dev:desktop`, `build:desktop`, `build:desktop:mac`. Add icon assets. Keep LICENSE/NOTICE (AGPL).
10. **Path audit** for Windows-only code (`\\`, drive letters, `.exe`, `cmd /c`), e.g. `claude-settings-permissions.service.ts` managed-settings path.
11. **Acceptance**: installed exe starts <5 s, UI works, quit leaves no stray processes; Mac checks 1–4 and 7 from the addendum.

## Order and checkpoints
0b-1 → 0b-2 → 0b-3..5 → verify/commit → Phase 1 steps 1–4 → 5–8 → 9–11. Report after 0b and after Phase 1.
