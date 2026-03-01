# Task Plan: Scheduled Task Management System (Cron Scheduler)

## Goal
为 CloudCLI 实现一套类 cron 的定时任务管理系统，包含后台调度引擎、Web 管理面板（MainContent 新 Tab）、执行历史追踪，以及供 Agent 使用的 Skill 文件。

## Current Phase
Phase 1

## Phases

### Phase 1: Backend Core — Database & Scheduler Engine
- [ ] 安装 `node-cron` 依赖
- [ ] 在 `init.sql` 追加 `scheduled_tasks` 和 `scheduled_task_executions` 两张表
- [ ] 在 `db.js` 新增 `scheduledTasksDb` 导出（全部 CRUD + 执行记录方法）
- [ ] 新建 `server/scheduler.js` — 调度引擎（init/schedule/unschedule/execute）
- [ ] 新建 `server/utils/scheduler-websocket.js` — WS 广播工具
- [ ] 新建 `server/routes/scheduled-tasks.js` — REST API（9 个端点）
- [ ] 修改 `server/index.js` — 挂载路由 + 初始化调度器
- **Status:** pending

### Phase 2: Frontend Panel — Tab & Components
- [ ] 修改 `src/types/app.ts` — AppTab 加 `'scheduler'`
- [ ] 新建 `src/types/scheduledTasks.ts` — TypeScript 接口
- [ ] 修改 `MainContentTabSwitcher.tsx` — 加 Scheduler tab
- [ ] 修改 `MainContent.tsx` — 渲染 ScheduledTasksPanel
- [ ] 新建 `src/components/scheduled-tasks/ScheduledTasksPanel.tsx` — 主面板
- [ ] 新建 `src/components/scheduled-tasks/TaskListTable.tsx` — 任务列表
- [ ] 新建 `src/components/scheduled-tasks/CreateTaskForm.tsx` — 创建表单
- [ ] 新建 `src/components/scheduled-tasks/TaskDetailView.tsx` — 详情+历史
- [ ] 修改 `src/utils/api.js` — 加 `scheduledTasks` API
- [ ] i18n 翻译文件（en/zh-CN 完整，ja/ko 占位）+ config.js 注册
- **Status:** pending

### Phase 3: Agent Skill
- [ ] 新建 `.claude/commands/scheduled-tasks.md` — Skill 文件
- **Status:** pending

### Phase 4: Integration & Verification
- [ ] WebSocket 实时更新验证
- [ ] 服务器重启后调度恢复验证
- [ ] 并发执行保护验证
- [ ] 历史自动清理验证（50 条/任务）
- [ ] `npm run build` 编译通过
- **Status:** pending

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| 用 `node-cron` 而非 `croner` | 社区广泛使用，API 简单，足够满足需求 |
| Claude CLI 用 `child_process.spawn -p` 而非 SDK `query()` | 进程隔离，崩溃不影响主服务；无需处理交互式权限弹窗 |
| Tab 始终可见（不像 TaskMaster 需条件判断） | 调度功能独立于项目，不依赖外部工具安装 |
| 每任务保留最近 50 条历史 | 用户选择，在存储和可用性间取平衡 |
| 输出截断 10KB | 防止大输出撑爆 SQLite |
| 三种任务类型：claude-cli / bash / http-webhook | 用户要求 |
| Windows 兼容用 cross-spawn | 项目已有依赖（cursor-cli.js 使用模式） |

## Key Files Reference

| File | Role |
|------|------|
| `server/database/db.js` | DB 层，参照 `apiKeysDb` 模式添加 |
| `server/database/init.sql` | DDL，末尾追加表 |
| `server/index.js` | 路由挂载（~L373）+ startServer 调度初始化 |
| `server/utils/taskmaster-websocket.js` | WS 广播模板 |
| `src/types/app.ts:3` | AppTab 类型定义 |
| `src/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx:19-24` | BASE_TABS 数组 |
| `src/components/main-content/view/MainContent.tsx:140-158` | Tab 条件渲染区 |
| `src/utils/api.js` | API 调用封装 |
| `src/i18n/config.js` | i18n 命名空间注册 |

## Config JSON Formats

### claude-cli
```json
{ "prompt": "...", "projectPath": "/path", "model": "sonnet", "maxTurns": 5, "allowedTools": ["Read","Grep"] }
```

### bash
```json
{ "command": "npm test", "cwd": "/path", "timeout": 60000 }
```

### http-webhook
```json
{ "url": "https://...", "method": "POST", "headers": {}, "body": "{}", "timeout": 30000 }
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/scheduled-tasks` | 列出所有任务 |
| POST | `/api/scheduled-tasks` | 创建任务 |
| GET | `/api/scheduled-tasks/:id` | 获取任务详情 |
| PUT | `/api/scheduled-tasks/:id` | 更新任务 |
| DELETE | `/api/scheduled-tasks/:id` | 删除任务 |
| POST | `/api/scheduled-tasks/:id/toggle` | 启用/禁用 |
| POST | `/api/scheduled-tasks/:id/run` | 立即运行 |
| GET | `/api/scheduled-tasks/:id/history` | 执行历史 |
| GET | `/api/scheduled-tasks/status` | 调度器状态 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       |         |            |

## Notes
- 开发顺序：Phase 1 → 2 → 3 → 4（严格依赖链）
- Phase 1 内部：schema → db methods → scheduler + routes（并行）→ index.js 集成
- Windows 环境注意 cross-spawn 和路径兼容
- 前端 Tab 命名用 `scheduler` 而非 `scheduled-tasks`（更简短）
