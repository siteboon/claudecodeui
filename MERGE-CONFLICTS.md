# 分支合并冲突解决手册

> 每次上游 main 更新后，从 clean main 重建 `local-fixes` 时使用。
>
> **版本**: v2.0 (2026-07-01) — 10 分支版本，基于 upstream/main `2ebe64f21`

## 当前分支状态

- **分支**: `local-fixes`（集成分支，push 到 fork origin）
- **上游 main**: `2ebe64f21` (fix: preview video on new tab #933)
- **上游自上次更新后新增 commits** (from `053f244`):
  - `2ebe64f21` fix: preview video on new tab (#933)
  - `b6cf33308` fix: resolve mobile shell issues (#923)
  - `6761f31a5` chore: remove computer use
  - `35da5d090` chore(release): v1.35.0
  - `d882f80b6` Consolidate desktop release workflow
- **最后合并日期**: 2026-07-01
- **分支总数**: 10 (7 PR + 3 local)

## 重建流程

```bash
cd ~/projects/cloudcli

# 1. 同步 main
git fetch upstream && git fetch origin
git checkout main && git merge upstream/main --ff-only
git push origin main --force-with-lease

# 2. 删除旧 local-fixes，从最新 main 重建
git checkout -B local-fixes main

# 3. 逐个 merge（见下方顺序）
```

## 合并顺序（严格遵守）

```bash
# ── Phase 1: 功能分支（7 个 PR）──

# 1. chat-message-display（聊天消息显示修复，PR #810）
#    commit 多 → 用 merge 而非 rebase（fix/chat-message-display-v2 分支）
git merge fix/chat-message-display --no-edit
# ✅ 本次无冲突

# 2. scroll-navigation-fixes-v2（滚动导航优化，PR #857）
#    commit 多 → 用 merge（feat/scroll-navigation-fixes-v2-updated 分支）
git merge feat/scroll-navigation-fixes-v2 --no-edit
# ⚠️ 冲突：useChatMessages.ts + useChatSessionState.ts

# 3. tasks-i18n-small（i18n 翻译 + Browser/Git 面板多语言，PR #941）
git merge fix/tasks-i18n-small --no-edit
# ✅ 本次无冲突（computer tab 已在 rebase 阶段移除）

# 4. session-pin（会话固定功能，PR #928）
git merge feat/session-pin --no-edit
# ⚠️ 冲突：claude-sdk.js + sessions.service.ts + useChatMessages.ts

# 5. password-reset-settings（密码重置设置，PR #925）
git merge feat/password-reset-settings --no-edit
# ⚠️ 冲突：en/zh-CN settings.json

# 6. streaming-output（流式输出修复，PR #924）
git merge fix/streaming-output --no-edit
# ✅ 本次无冲突

# 7. auto-rename-session-fix（AI 会话自动重命名，PR #934）
git merge feat/auto-rename-session-fix --no-edit
# ✅ 本次无冲突

# ── Phase 2: local 分支（3 个）──

# 8. browser-npm-fix（浏览器 npm 修复）
git merge local/browser-npm-fix --no-edit
# ✅ 本次无冲突

# 9. prd-editor-fix（产品编辑器修复）
git merge local/prd-editor-fix --no-edit
# ✅ 本次无冲突

# 10. taskmaster-fix（TaskMaster 修复）
git merge local/taskmaster-fix --no-edit
# ✅ 本次无冲突

# ── 完成 ──
# 推送
git push origin local-fixes --force-with-lease
```

---

## 冲突 2: `scroll-navigation-fixes-v2`

### 文件 1: `src/components/chat/hooks/useChatMessages.ts` (行 ~59)

**冲突内容**: `.trim()` 语义差异。
```
<<<<<<< HEAD
          const taskNotifMatch = taskNotifRegex.exec(content);
=======
          const taskNotifMatch = taskNotifRegex.exec(content.trim());
>>>>>>> feat/scroll-navigation-fixes-v2
```
**解决**: 取 **scroll-navigation** 的 `.trim()` 版本。正确处理带前后空白的 task notification。

### 文件 2: `src/components/chat/hooks/useChatSessionState.ts` (行 ~271)

**冲突内容 — 核心逻辑**:
```
<<<<<<< HEAD
    const hasEchoedPendingMessage = pendingUserMessage
      ? all.some(
          (m) =>
            m.type === 'user'
            && m.content === pendingUserMessage.content
            && String(m.timestamp) === String(pendingUserMessage.timestamp),
        )
      : false;
    if (pendingUserMessage && !hasEchoedPendingMessage) {
=======
    const hasUserMessage = all.some((m) => m.type === 'user');
    if (pendingUserMessage && !hasUserMessage) {
>>>>>>> feat/scroll-navigation-fixes-v2
```
**解决**: 取 **HEAD**（chat-message-display）的精确匹配。scroll-navigation 的逻辑只要有任意 user 消息就认为 pending 已出现，这是 bug——会导致多次重复发送时 pending 消息被错误丢弃。

---

## 冲突 4: `session-pin`

### 文件 1: `server/claude-sdk.js`

**解决**: 取 **--ours**（HEAD 版本）。

### 文件 2: `server/modules/providers/services/sessions.service.ts`

**解决**: 取 **--ours**（HEAD 版本）。

### 文件 3: `src/components/chat/hooks/useChatMessages.ts`

**解决**: 取 **--ours**（HEAD 版本）。

---

## 冲突 5: `password-reset-settings`

### 文件 1: `src/i18n/locales/en/settings.json`

**冲突内容**: HEAD 已有其他设置的 JSON 结构，password-reset 新增 password 命名空间。
**解决**: 取 **--theirs**（保留新增的 password 翻译）。

### 文件 2: `src/i18n/locales/zh-CN/settings.json`

**解决**: 取 **--theirs**（保留新增的密码翻译）。

---

## 冲突解决策略总结

| 场景 | 策略 | 原因 |
|------|------|------|
| 功能代码冲突（hooks, service） | **HEAD/ours** | local-fixes 已包含更完善的修复（chat-message-display 的精确匹配等） |
| i18n 翻译冲突（settings.json） | **theirs** | 新增翻译需要保留 |
| computer tab 冲突 | **删除** | 上游已移除 computer-use 模块 |
| 无冲突 | **auto-merge** | Git 自动解决 |

---

## Rebase 策略（PR 分支独立维护）

在重建 local-fixes 之前，每个 PR 分支需要 rebase 到最新 main：

- **commit ≤ 8**: 用 `rebase`（保持线性历史）
  - `feat/password-reset-settings` (1 commit) ✅
  - `feat/auto-rename-session-fix` (2 commits) ✅
  - `fix/streaming-output` (2 commits) ✅
  - `fix/tasks-i18n-small` (8 commits, 1 冲突 — computer tab) ✅

- **commit ≥ 10**: 用 `merge` 创建新分支（避免逐 commit 冲突）
  - `fix/chat-message-display` (10 commits) → `fix/chat-message-display-v2`
  - `feat/scroll-navigation-fixes-v2` (11 commits) → `feat/scroll-navigation-fixes-v2-updated`

---

## 已知副作用 / 合并后必查

1. `useChatComposerState.ts` 可能缺少 `resolvedProjectPath` / `sessionSummary` 变量定义（chat-message-display + scroll-navigation 交叉覆盖导致）。合并后 grep 确认。
2. `useChatRealtimeHandlers.ts` 合并后有 2 层 switch（legacy + normalized），合并后检查 `case` 不重复、`switch` 不嵌套。
3. `useChatMessages.ts` 合并了 3 个分支的改动（scroll-navigation、session-pin），检查是否有重复逻辑。
4. 上游移除了 `computer-use` 模块，确保 `zh-CN/common.json` 中的 `computer` tab 翻译已被移除。

---

## 验证清单

合并完成后执行：

```bash
# 1. 语法/构建检查
pnpm run build:client && pnpm run build:server

# 2. 部署 + 功能验证
# - 新建 session 不报错
# - 消息顺序正确（旧在上，新在下）
# - session pin/bookmark 功能正常
# - Browser/Git 面板中文显示正确
# - AI 自动重命名 session 标题
# - 终端发的消息在聊天界面能看到
# - 滚动导航/加载更多正常工作
# - 流式输出正常显示
# - 密码重置设置页面正常
```

---

## 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-06-28 | v1.0 | 初始版本（6 分支：browser-npm-fix, tasks-i18n-small, auto-rename-session, session-pin, chat-message-display, scroll-navigation） |
| 2026-07-01 | v2.0 | 更新为 10 分支（+ password-reset-settings, streaming-output, prd-editor-fix, taskmaster-fix；auto-rename-session 重命名为 auto-rename-session-fix；local-fixes 现在 push 到 fork） |
