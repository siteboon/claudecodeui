# claudecodeui 改进设计文档

- **日期**：2026-06-23
- **作者**：黄权权 + Claude（Opus 4.7）
- **状态**：设计已对齐 · 待 writing-plans 拆任务

## 0 · 背景

老板自用的 claudecodeui 实例（fork 自 siteboon/claudecodeui · 已切到 `git@github.com:invoke888/claudecodeui.git`）需要 8 条改进 + 1 项 git 仓库切换 · 服务老板个人工作流：自建 CLAUDE.md 模板库 / 隔离外部项目 / 会话命名 / 全局 CLAUDE.md 编辑 / 去除社区入口 / sidebar 体验 / 简体中文补全 / 文件查看宽度修复。

## 1 · 需求与决策汇总

| # | 需求 | 决策（老板已拍板） |
|---|---|---|
| 1 | CLAUDE.md 模板库 | DB 表 `claude_md_templates` · 设置加管理 tab · 项目向导加可选模板步骤 · **多选叠加** · 应用方式 = **写入项目根 CLAUDE.md** |
| 2 | 隐藏 tmp 项目 + 只显示自建 | `projects` 表加 `is_user_created` 列 · UI 向导建的标 1 · jsonl 同步的标 0 · sidebar toggle 默认「只显示自建」|
| 3 | 新建会话直接命名 | composer 顶上加**可选**名称输入框 · 留空走旧自动命名 |
| 4 | 设置编辑 CLAUDE.md | **只全局** `~/.claude/CLAUDE.md` · 复用 Monaco code-editor · 项目级走 file-tree 手开 |
| 5 | 去掉报告问题/加入社区 | 删 5 文件的入口（SidebarFooter / SidebarCollapsed / AboutTab 的 Star+GitHub+Discord 3 按钮 / VersionInfoSection 的 GitHub link / AuthScreenLayout 的 GitHub 链接）|
| 6 | 会话默认全部展开 + 切换按钮 | sidebar 初始化时把所有项目 id 进 `expandedProjects` Set · 顶上加「全展开 ⇄ 全折叠」按钮 |
| 7 | 简体中文漏译补全 | **6 个 namespace 全审**（auth/chat/codeEditor/common/settings/sidebar · 共 1193 行 + 其他硬编码英文）|
| 8 | 文件查看宽度老变 | 根因 = ResizeObserver 自动重算 + 没持久化 · 修法 = 移除 Observer 自动逻辑 + localStorage 持久化拖动结果 + app_config 兜底 |
| ★ | git remote 切换 | `origin` → `git@github.com:invoke888/claudecodeui.git` · 旧的 rename 成 `upstream` 保留 |

## 2 · 架构总览

### 2.1 系统组件

- **前端**：React 18 + Vite + TypeScript · 组件位置 `src/components/`
- **后端**：Node Express + TypeScript · `server/`
- **数据库**：SQLite · schema 在 `server/modules/database/schema.ts` · 迁移在 `migrations.ts`
- **i18n**：i18next · locale 文件在 `src/i18n/locales/<lang>/<namespace>.json`
- **桌面**：Electron（不在本次改动范围）

### 2.2 改动边界

- **不动**：Electron 打包 / WebSocket / 认证模块 / Cursor/Gemini/OpenAI SDK 集成 / Git 面板 / MCP / Task Master / Browser Use
- **动**：项目列表 / sidebar / settings / project-creation-wizard / chat composer / code-editor sidebar / i18n locale / 数据库 schema

## 3 · 数据层

### 3.1 新建表：`claude_md_templates`

```sql
CREATE TABLE IF NOT EXISTS claude_md_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  alias       TEXT    NOT NULL UNIQUE,           -- 模板别名(唯一)
  content     TEXT    NOT NULL,                  -- 模板正文(Markdown)
  enabled     INTEGER NOT NULL DEFAULT 1,        -- 启用状态 0/1
  sort_order  INTEGER NOT NULL DEFAULT 0,        -- 多选叠加顺序
  created_at  INTEGER NOT NULL,                  -- unix ts
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_enabled_sort
  ON claude_md_templates(enabled, sort_order);
```

### 3.2 `projects` 表新增列

```sql
ALTER TABLE projects ADD COLUMN is_user_created INTEGER NOT NULL DEFAULT 0;
-- 1 = UI 向导创建
-- 0 = 外部 claude jsonl 同步进来(默认 · 历史项目都是 0)
```

历史项目升级时全部为 0 · sidebar 默认 toggle = 只显示自建 = 历史项目被隐藏 · 老板切换 toggle 到「显示全部」即可看到所有项目 · 不丢数据。

### 3.3 `app_config` 表新增 key

| key | 类型 | 默认 | 用途 |
|---|---|---|---|
| `sidebar.showOnlyUserCreated` | bool | `true` | 默认只显示 UI 创建的项目 |
| `sidebar.defaultExpandAll` | bool | `true` | 新会话进来默认全展开 |
| `editor.sidebar.width` | int | `280` | 文件查看 sidebar 宽度（与 localStorage 双写）|

### 3.4 迁移策略

- 加单条迁移到 `server/modules/database/migrations.ts` · 不改老迁移
- 迁移必须**幂等**（跑两次不报错 · `IF NOT EXISTS` / `ADD COLUMN` 容错）
- 升级后跑一次 typecheck + 启动 server 看日志无报错

## 4 · API 层

### 4.1 新增 endpoints（PR3）

#### 模板 CRUD

| Method | Path | Body / Query | 返回 |
|---|---|---|---|
| `GET` | `/api/templates` | — | `[{id, alias, enabled, sort_order, updated_at}]`（不含 content · 列表瘦身）|
| `GET` | `/api/templates/:id` | — | `{id, alias, content, enabled, sort_order, ...}` |
| `POST` | `/api/templates` | `{alias, content, enabled?, sort_order?}` | `{id, ...}` · alias 冲突 → 409 |
| `PUT` | `/api/templates/:id` | 部分字段 | 更新后的对象 |
| `DELETE` | `/api/templates/:id` | — | `204` |
| `POST` | `/api/templates/preview` | `{template_ids: number[]}` | `{content: string}` · 按 sort_order 拼接 + `\n\n---\n\n` 分隔 |

#### 全局 CLAUDE.md

| Method | Path | Body | 返回 |
|---|---|---|---|
| `GET` | `/api/claude-md/global` | — | `{content: string, last_modified: number}` · 文件不存在返空串 |
| `PUT` | `/api/claude-md/global` | `{content: string}` | `{last_modified: number}` |

### 4.2 改造现有 endpoints（PR2 / PR3）

| Endpoint | 改造 | PR |
|---|---|---|
| `POST /api/projects/create` | body 加 `templateIds?: number[]` + `displayName?` · 创建项目目录后按 sort_order 拼接模板写入根 CLAUDE.md · 标 `is_user_created=1` | PR2 标记列 / PR3 模板写入 |
| `GET /api/projects` | 加 query `onlyUserCreated=true/false` · 默认读 `app_config` | PR2 |
| `POST /api/sessions`（或现有创建会话路径）| body 加 `displayName?: string` · 不传走原自动命名 | PR2 |

### 4.3 安全 / 边界

- `/api/claude-md/global` 路径**写死** `~/.claude/CLAUDE.md` · 不接收用户路径参数
- 写入前 `path.resolve` + 验证最终路径在 `os.homedir() + '/.claude/'` 内 · 越权 403
- 模板 content 不 sanitize（纯 Markdown 文本）· 但限长 100KB
- 创建项目时若 templateIds 包含已删除/disabled → 静默跳过 · 不报错（容错）
- 别名 alias 限长 64 字符 · 不允许换行 / 控制字符

## 5 · 前端层

### 5.1 设置面板新增 2 个 tab（PR3）

```
src/components/settings/view/tabs/
├── templates-settings/
│   ├── TemplatesTab.tsx              ← 列表(启用开关 / 别名 / 字数 / 拖拽手柄 / 编辑 / 删除)
│   ├── TemplateEditorDialog.tsx      ← 别名+正文编辑 · 用 code-editor Monaco
│   └── hooks/useTemplates.ts         ← react-query 封装 CRUD
└── claude-md-settings/
    └── ClaudeMdTab.tsx               ← 单 Monaco 编辑器 + 保存按钮 + 最后保存时间
```

### 5.2 项目向导加可选模板步骤（PR3）

```
src/components/project-creation-wizard/components/
└── StepTemplateSelect.tsx            ← 插入到 StepConfiguration 与 StepReview 之间
```

UI 要点：
- 只显示 `enabled=1` 的模板
- 勾选框 + 别名 + content 前 80 字预览
- 「跳过 · 不应用模板」按钮（等价全不选）
- 右侧实时预览叠加结果 · 复用 `/api/templates/preview`

### 5.3 Sidebar 改造（PR1 + PR2）

| 改动 | PR | 文件 |
|---|---|---|
| 删社区入口 | PR1 | `SidebarFooter.tsx` · `SidebarCollapsed.tsx` |
| 默认全展开 | PR1 | `useSidebarController.ts:168-184` 初始化 expandedProjects = 所有项目 id |
| 全展开/折叠按钮 | PR1 | Sidebar 顶上加 `<button>` · 切换 expandedProjects Set 大小 0 / N |
| 隐藏外部项目 toggle | PR2 | 列表过滤 `if (showOnlyUserCreated && !project.is_user_created) return false` · 设置 / sidebar 顶上都暴露 |

### 5.4 Composer 会话命名（PR2）

```
src/components/chat/view/composer/ComposerHeader.tsx     ← 加可折叠输入框
src/components/chat/hooks/useChatComposerState.ts:613-645 ← 创建会话时带 displayName
```

UI 要点：
- composer 顶上一个**可折叠**小输入框「会话名称（可选）」· 默认折叠
- 新会话第一次发消息 · 输入框非空 → 创建时带过去 · 空 → 走自动命名
- 已建会话不显示该输入框（重命名走现有右键菜单）

### 5.5 文件查看宽度修复（PR2）

```
src/components/code-editor/hooks/useEditorSidebar.ts
src/components/code-editor/view/EditorSidebar.tsx
```

修法：
1. 移除 ResizeObserver 自动调宽逻辑 · 父容器变动只影响主区
2. 拖动结束（mouseup）→ `localStorage.setItem('editor.sidebar.width', width)` + 后端 `app_config` 兜底
3. 初次挂载从 localStorage 读 · 没有用默认 280px
4. 最小/最大宽度约束 200 / 600 · 防误拖到 0

### 5.6 删除社区入口（PR1）

| # | 文件 | 操作 |
|---|---|---|
| 1 | `src/components/sidebar/view/subcomponents/SidebarFooter.tsx` | 删 4 处入口 + 常量 |
| 2 | `src/components/sidebar/view/subcomponents/SidebarCollapsed.tsx` | 删常量 |
| 3 | `src/components/settings/view/tabs/AboutTab.tsx` | 删 Star/GitHub/Discord 3 按钮（保留版本号/介绍）|
| 4 | `src/components/settings/view/tabs/api-settings/sections/VersionInfoSection.tsx` | 删 GitHub link |
| 5 | `src/components/auth/view/AuthScreenLayout.tsx:48` | 删 GitHub 链接 |

i18n key `sidebar.actions.reportIssue` / `sidebar.actions.joinCommunity` 可以删 · 也可以留（不渲染就行）· 这里保守**保留** · 避免破坏其他 locale。

### 5.7 简体中文补全（PR3）

工作流：
1. 扫描 `src/` 下所有 `.tsx/.ts` 找硬编码英文字符串（非 import / 测试 / logger）
2. 抽到 `src/i18n/locales/zh-CN/` 6 个 namespace · key 命名 `<area>.<scope>.<name>`
3. 同步加 key 到其他 9 个 locale · 值先复制英文 + 标 TODO（不机翻）
4. `npm run lint` + 视觉抽查关键页面

边界：
- **保留英文**：技术术语 (PR/commit/branch/token/API) · 命令名 (claude/gemini) · 文件名
- **必须汉化**：按钮文案 / 表单 label / 提示 / 错误消息 / 空态文案 / tooltip

## 6 · git remote 切换

```bash
# 已在 design 阶段完成:
git remote rename origin upstream
git remote add origin git@github.com:invoke888/claudecodeui.git

# 验证(已通过):
# origin    git@github.com:invoke888/claudecodeui.git
# upstream  https://github.com/siteboon/claudecodeui
# ssh -T git@github.com → Hi invoke888!
# git ls-remote origin → main HEAD 与本地一致(4712431)
```

## 7 · PR 拆分

### 7.1 PR1 · 低风险快速合（预计 2-4 小时）

| 任务 | 文件数 |
|---|---|
| git remote 切换 + 首推 design doc 到 origin | 0 code 文件 |
| 删社区入口 (5 文件) | 5 |
| sidebar 默认全展开 | 1 |
| sidebar 加全展开/折叠按钮 | 1-2 + i18n |
| i18n key 加 expandAll/collapseAll (10 locale) | 10 |

**验收**：
- `git remote -v` 显示 origin = invoke888
- `npm run dev` 启动 · sidebar 无社区入口
- AboutTab 无 Star/GitHub/Discord 按钮
- 新会话默认全展开 · 点折叠全收起 / 再点全展开
- playwright 截图：sidebar 两态 / AboutTab / 登录页

### 7.2 PR2 · 中等风险（预计 4-6 小时）

| 任务 | 文件数 |
|---|---|
| DB 迁移：`is_user_created` 列 + 3 个 app_config key | 1-2 |
| projects API：`onlyUserCreated` query + create 时标 1 | 2-3 |
| sidebar 加显示外部项目 toggle | 2-3 + i18n |
| composer 加可选会话名称输入框 | 2 |
| sessions API：body 加 displayName | 1-2 |
| EditorSidebar 宽度持久化 + 移除 ResizeObserver 抖动 | 2 |

**验收**：
- 数据库迁移幂等
- 老项目升级后默认隐藏 · toggle 切换可显示
- 向导新建项目自动标 1 · sidebar 立刻可见
- composer 名称：填了用填的 · 不填走自动名（两条 case）
- 文件查看宽度持久化（拖动 → 切文件 → 重开 · 宽度不变）
- 父容器 resize 不再改 sidebar 宽
- playwright 截图

### 7.3 PR3 · 大功能（预计 1-2 天）

| 任务 | 文件数 |
|---|---|
| DB 迁移：claude_md_templates 表 | 1 |
| 模板 API CRUD + preview + 全局 CLAUDE.md 读写 | 2 个新路由 |
| 设置面板加 2 tab：模板管理 + 全局 CLAUDE.md | 4-6 |
| 项目向导加 StepTemplateSelect | 1-2 |
| 创建项目时按 templateIds 写根 CLAUDE.md | 1-2 |
| 简体中文补全 6 namespace | 60+ locale 文件 |

**验收**：
- 模板 CRUD 全流程（建 / 编辑 / 启停 / 排序 / 删）
- 别名唯一冲突 → 409 + toast
- 多选叠加预览正确
- 新项目 CLAUDE.md = 拼接结果（`\n\n---\n\n` 分隔）
- 不选模板 → 不写 CLAUDE.md
- 设置编辑全局 CLAUDE.md · 保存后 `cat ~/.claude/CLAUDE.md` 一致
- 路径穿越测试 → 403
- 简体中文页面无硬编码英文（playwright 截图：sidebar / settings / chat / composer / file-tree / 向导）

## 8 · 全局 done 标准

跨所有 PR：
- ✅ `npm run typecheck` 零错误零警告（铁律 8）
- ✅ `npm run lint` 零错误
- ✅ `npm run build` 通过
- ✅ playwright 真机截图 · 不靠 sim PASS
- ✅ 数据库迁移可重入
- ✅ 每个 PR 都有 sub-PR 描述 + verify 报告

## 9 · 风险与缓解

| 风险 | 缓解 |
|---|---|
| `is_user_created=0` 默认隐藏 → 老板第一次升级看不到所有老项目以为丢了 | toggle 默认在 sidebar 顶上**可见** · 第一次切换有 onboarding 提示「老项目默认隐藏 · 切到全部查看」|
| 模板写入项目根 CLAUDE.md 覆盖已有内容 | 创建新项目时该文件本就不存在 · 直接写 · 若存在(同名项目)→ 报错让用户改名 |
| 全局 CLAUDE.md 编辑覆盖老板手写的内容 | 编辑器加「最后修改时间」显示 · 保存前 confirm 「你正在覆盖 X 时刻的版本」|
| 汉化漏译范围大 · 漏抓硬编码英文 | PR3 加扫描脚本 `grep -rn '"[A-Z][a-z]\+ [A-Z]\?[a-z]\+"' src/components/` 兜底 |
| ResizeObserver 移除后某些场景宽度不更新 | 改完手测窗口缩放 / 移动端 viewport / split view 等场景 |

## 10 · 后续阶段

设计批准后：
1. 调用 `superpowers:writing-plans` skill · 把 PR1/PR2/PR3 各自拆成可执行任务清单
2. PR1 先执行 · 走 `superpowers:subagent-driven-development` 或我直接干（视复杂度）
3. 每个 PR 完工走 `superpowers:verification-before-completion` + playwright 截图自验 → 报告
4. 老板拍板 merge → 切下一个 PR
