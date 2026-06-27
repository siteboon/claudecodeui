# 分支合并冲突解决手册

> 每次上游 main 更新后，从 clean main 重建 `local-fixes-X` 时使用。

## 合并顺序（严格遵守）

```bash
git checkout -b local-fixes-X main

# 1. i18n 翻译（无冲突）
git merge fix/tasks-i18n-zhcn-ko --no-edit

# 2. session pin（无冲突）
git merge feat/session-pin --no-edit

# 3. chat message display（有冲突 ↓）
git merge fix/chat-message-display --no-edit

# 4. scroll navigation（有冲突 ↓）
git merge fix/scroll-navigation-fixes-v2 --no-edit
```

---

## 冲突 1: `session-pin` + `chat-message-display`

### 文件: `server/claude-sdk.js` (行 ~64)

**冲突内容:** 空行差异
```
<<<<<<< HEAD
=======

>>>>>>> fix/chat-message-display
```
**解决:** 删除冲突标记，保留一个空行（取 chat-message-display 的版本）

---

### 文件: `server/modules/providers/services/sessions.service.ts` (行 ~80)

**冲突内容:**
```
<<<<<<< HEAD
  if (!session?.jsonl_path || session.provider !== LLMProvider.CLAUDE) return;
=======
  if (!session?.jsonl_path) return;
>>>>>>> fix/chat-message-display
```
**解决:** 取 `=======` 下面的版本（chat-message-display）。chat-message-display 的版本不限制 provider，支持所有 provider 的 session title。

---

### 文件: `server/modules/providers/services/sessions.service.ts` (行 ~147)

**冲突内容:**
```
}
<<<<<<< HEAD
=======

/**
>>>>>>> fix/chat-message-display
```
**解决:** 保留空行 + JSDoc 注释开头（取 chat-message-display 的版本）

---

## 冲突 2: `scroll-navigation-fixes-v2` + `chat-message-display`

### 文件: `src/components/chat/hooks/useChatMessages.ts` (行 ~59)

**冲突内容:** `.trim()` 语义差异
```
<<<<<<< HEAD
          const taskNotifMatch = taskNotifRegex.exec(content);
=======
          const taskNotifMatch = taskNotifRegex.exec(content.trim());
>>>>>>> fix/scroll-navigation-fixes-v2
```
**解决:** 取 `>>>>>>>` 上面的版本（scroll-navigation 的 `.trim()`）。加了 `.trim()` 能正确处理带前后空白的 task notification。

---

### 文件: `src/components/chat/hooks/useChatSessionState.ts` (行 ~271)

**冲突内容 1 - 注释:**
```
<<<<<<< HEAD
    // Show pending user message until its own echoed entry appears in the store.
=======
    // Show pending user message until a user message actually appears in the store.
>>>>>>> fix/scroll-navigation-fixes-v2
```
**解决:** 取 `<<<<<<<` 下面的版本（chat-message-display）。注释更精确描述了实际逻辑。

---

**冲突内容 2 - 核心逻辑:**
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
>>>>>>> fix/scroll-navigation-fixes-v2
```
**解决:** 取 `<<<<<<<` 下面的版本（chat-message-display 的精确匹配）。scroll-navigation 的逻辑只要有任意 user 消息就认为 pending 已出现，这是 bug——会导致多次重复发送时 pending 消息被错误丢弃。

---

## 合并后必须补的修复

合并完 4 个分支后，`useChatComposerState.ts` 会缺少两个变量定义（这是合并时的副作用，不是冲突）：

**文件:** `src/components/chat/hooks/useChatComposerState.ts` (行 ~610，在 `let targetSessionId` 之前)

需要添加：
```typescript
      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const sessionSummary = getNotificationSessionSummary(selectedSession, currentInput);
```

这两行在 `fix/chat-message-display` 分支的 commit `48061f4` 中，但 scroll-navigation 分支覆盖了这段代码导致丢失。每次合并后必须补上。

---

## 验证清单

合并完成后执行：

```bash
npm run build          # 应该 0 error
# 部署测试：
# 1. 新建 session 不报错
# 2. 消息顺序正确（旧在上，新在下）
# 3. 终端发的消息在聊天界面能看到
# 4. session pin/bookmark 功能正常
```
