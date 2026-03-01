# Upstream PR Contribution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `feature/personal-enhancements` (32 commits) into independent feature branches and submit focused PRs to `upstream` (`siteboon/claudecodeui`).

**Architecture:** Sync local `main` with `upstream/main`, create per-feature branches, cherry-pick/port relevant commits, resolve conflicts, verify builds, push and open PRs.

**Tech Stack:** Git (cherry-pick, rebase), GitHub CLI (`gh`), npm (build verification)

---

## Execution Progress

| Task | PR | Status | Notes |
|------|----|--------|-------|
| Task 0: Stash & Sync | — | DONE | main synced to `9e22f42`, pushed to origin |
| Task 1: React 18 Message Sync | [#461](https://github.com/siteboon/claudecodeui/pull/461) | DONE | Skipped commit `9a84153` (core fix already in upstream's subscribe pattern). Cherry-picked f71a2f8, ceaa704, c9fa0fc, 2ff419e cleanly. Squashed to 1 commit. |
| Task 2: WebSocket Permission | [#462](https://github.com/siteboon/claudecodeui/pull/462) | DONE | Cherry-pick failed (architecture diverged). Manually ported to upstream code: added writer storage, reconnectSessionWriter, getPendingApprovalsForSession, frontend recovery effect. |
| Task 3: Tool Display Refactor | — | SKIPPED | Commit `631f3f7` only touches `BackgroundTasksPopover.tsx` which doesn't exist on main. Merged into Task 5. |
| Task 4: Slash Commands | [#466](https://github.com/siteboon/claudecodeui/pull/466) | DONE | Manual porting. Added scanUserSkills/scanPluginSkills, multi-command parsing, skill-loaded card, autocomplete behavior. 8 files, +639/-82 lines. |
| Task 5: Background Tasks | — | TODO | Very high difficulty — needs brainstorming first |
| Task 6: System Messages | [#463](https://github.com/siteboon/claudecodeui/pull/463) | DONE | Manual porting of classifyUserMessage() + collapsible card rendering. No cherry-pick. |
| Task 7: Cleanup | — | TODO | — |

---

## Current Git State (2026-03-01 20:00 UTC+8)

- **Current branch:** `feat/slash-commands-skills` (at commit `68f5272`)
- **Stash:** `WIP: unstaged changes during PR split` (from `feature/personal-enhancements`)
- **feature/personal-enhancements:** Untouched, safe
- **Branches created & pushed:** `fix/react18-message-sync`, `fix/websocket-permission-persistence`, `feat/system-injected-messages`, `feat/slash-commands-skills`
- **PRs open:** [#461](https://github.com/siteboon/claudecodeui/pull/461), [#462](https://github.com/siteboon/claudecodeui/pull/462), [#463](https://github.com/siteboon/claudecodeui/pull/463), [#466](https://github.com/siteboon/claudecodeui/pull/466)

**下一轮启动指令（复制粘贴即可）：**
```
git checkout main

然后执行 Task 5 brainstorming:
/superpowers:brainstorm 深度研究 Task 5 (Background Tasks Management)。分析 feature/personal-enhancements 分支中后台任务相关的所有 commits 和文件，对比 upstream/main 最新代码结构，设计全面的移植方案。参考 @docs/plans/2026-03-01-upstream-pr-contribution.md 中的 Task 5 描述和 Lessons Learned。
```

**Task 5 涉及的 feature 分支文件（供 brainstorm 参考）：**
- 新文件: `server/ws-clients.js`, `src/components/chat/BackgroundTasksPage.tsx`, `src/components/chat/BackgroundTasksPopover.tsx`
- 新 i18n: `src/i18n/locales/*/backgroundTasks.json` (en, ja, ko, zh-CN)
- 修改: `server/claude-sdk.js` (后台会话管理), `server/index.js` (API 路由), `server/routes/commands.js` (getToolInputSummary)
- 修改: `src/components/app/AppContent.tsx`, `src/components/sidebar/Sidebar.tsx`
- 修改: `src/components/chat/hooks/useChatRealtimeHandlers.ts`, `src/contexts/WebSocketContext.tsx`
- 修改: `src/i18n/i18n.ts` (注册 backgroundTasks namespace)

---

## Lessons Learned

1. **Cherry-pick rarely works cleanly.** Upstream has done major refactors (component splits, Gemini integration, SDK upgrade). Most commits from `feature/personal-enhancements` conflict. **Default approach should be manual porting**, not cherry-pick.

2. **Check commit scope before planning.** Commit `631f3f7` (Tool Display) and `eaaf3ac` (System Messages) both bundle unrelated changes. Always verify `git diff-tree --name-only` matches the plan's assumptions.

3. **Check if upstream already solved the problem.** Commit `9a84153`'s core fix (subscribe pattern bypassing React 18 batching) was already in upstream. Skipping it avoided a meaningless conflict.

4. **`git rebase -i` doesn't work in non-interactive CLI.** Use `git reset --soft main && git commit` for squashing.

5. **`npm install` needed after syncing main.** Upstream added new dependencies. Run `npm install` on each new branch before `npm run build`.

6. **Watch for extra files leaking into commits.** Task 4 commit included `docs/plans/2026-03-01-upstream-pr-contribution-design.md` and `task_plan.md` — should have been excluded. Always use `git add <specific files>` instead of `git add -A`.

---

## Remaining Tasks

### Task 5: PR — Background Tasks Management

**Difficulty: Very high.** Largest PR, ~400 lines of new server code, 11+ commits, manual porting required for all server files.

**Approach:** Manual porting — the only option. Key steps:
1. Copy new files from feature branch (ws-clients.js, UI components, i18n)
2. Manually port server-side logic to upstream's `claude-sdk.js`
3. Manually port API routes to upstream's `index.js` and `commands.js`
4. Manually port frontend integration (AppContent, Sidebar, useChatRealtimeHandlers, WebSocketContext, i18n config)

**Additional note:** Include `631f3f7` (getToolInputSummary helper) as part of this PR since it only touches `BackgroundTasksPopover.tsx`.

**⚠️ Needs brainstorming first:** This is complex enough to require a full design doc before implementation. Run brainstorming skill to analyze upstream's current code structure and design the porting approach.

---

### Task 7: Cleanup

**Steps:**
```bash
git checkout feature/personal-enhancements
git stash pop  # Restore working changes
# Update CLAUDE.md with PR URLs and status
```

---

## Checklist per PR

Before pushing each PR, verify:

- [ ] Branch is based on latest `main` (which tracks `upstream/main`)
- [ ] No `debug:` commits included
- [ ] No cross-feature changes leaked in
- [ ] `npm run build` passes (run `npm install` first if dependencies changed)
- [ ] Commit messages follow Conventional Commits
- [ ] UI changes include screenshots in PR body
- [ ] No `Co-Authored-By` or emoji generated lines in commits
- [ ] Use `git add <specific files>` — never `git add -A`
