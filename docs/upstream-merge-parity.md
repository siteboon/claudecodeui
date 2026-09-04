# Fork 特性迁移对照报告（上游 #1206 合并后）

> 基线：feature/zcode 分支 79 个 fork 提交（v1.37.2 分叉点 → cbe2d21）
> 合并：b682da8（merge upstream #1206/#1239）→ 18ea04e（oxlint 对齐 + PWA 恢复接线）
> 验证：tsc 双端 0 错误 · oxlint 0 errors（规则与上游一致）· vitest 284/284 · 服务端 559/559 · perf harness GREEN

## 一、需求清单 × 迁移状态

| # | 需求 | 关键提交 | 状态 | 说明 |
|---|---|---|---|---|
| 1 | ZCode provider 全栈（runtime 编解码/supervisor/router、模型、skills、MCP、终端通知） | c8a9be5, abb193d, 4e2c84a 等 | ✅ 完整 | `server/modules/providers/list/zcode/` 15 个文件，逐符号核对在位 |
| 2 | Antigravity provider 全栈（OAuth/keychain/邮箱、`--add-dir`、30m print 超时、quota、工具映射、模型×档位合并、stream_end 边界、数据根、MCP 路径、权限模式） | 47f5b77 起 20+ | ✅ 完整 | `list/antigravity/` 12 文件 + quota provider；运行时细节（--add-dir/30m timeout）抽查在位 |
| 3 | CLI 安装探测/引擎路径（异步 probe、正负 TTL 缓存、共享 resolver、按安装状态过滤） | 0629387, 2baeaf0, 4f2fe91, ad6c856 | ✅ 完整 | `shared/installation/cli-installation-probe.ts` + 各家 engine-path |
| 4 | 会话生命周期（provider_session_id 查找/清理、防复活、清理下沉 facet、自动归档） | 67f7c5b, 2c85e61, a9463d0, c7dd4e5 | ✅ 完整 | superseded 表 + auto-archive 服务在位 |
| 5 | 滚动性能专项（原生锚定稳定器、WS 帧解耦、身份保稳、Markdown memo/PrismLight、CDP harness） | 00e45d7→cbe2d21 | ✅ 完整且已验证 | 合并后 perf harness 三项 GREEN |
| 6 | 重复输出 dedupe 链（turn 边界、whitespace 容忍、拼接段、per-session 流缓冲） | 92786a4 等 7 组 | ✅ 完整 | 三个纯函数模块 + dedupe 测试全绿 |
| 7 | PWA 冷启动恢复 | d87c7c3 | ⚠️→✅ 已修复 | 旧壳删除导致 hook 脱线；已接线到 `ProjectWorkspaceRouteContent` |
| 8 | 消息 UI 细节（diff stats、头像外置、隐藏 find_by_name 成功行、导出定制、file:// 计划链接只读打开、外部媒体流式） | 6 个 | ✅ 完整 | 逐项核对在位 |

## 二、上游新架构上的替代方案评估

| 领域 | 上游方案 | 结论 |
|---|---|---|
| 滚动稳定 | scrollPositionRef + 手动锚点捕获 | **保留 fork 方案**：原生锚定 + RO 贴底更优，且有量化护航 |
| 流式渲染 | StreamingMarkdown（已删） | 当前转换缓存 + memo 够用；超长流式消息如有重 parse 开销可借鉴其分块思路 |
| Provider 模型选择 | `providerModels` 统一 map + `setProviderModel` | ✅ **已采用上游方案**（18ea04e 后续提交）：6 个 per-provider state + 12 个 props 收敛为单 map + 2 props，6 段重复 reconcile effect 合并为一段；存储键保持 `<provider>-model` 不变，用户既有选择不受影响 |
| 消息编辑/fork | transcriptAnchorId + resolveEditAnchor/rewindSession | 服务端 facet 已并入（codex 完整）；**前端编辑入口未接**，可选缺口 |
| 定时消息 | ScheduleMessagePopover 等组件 | 组件在树但 fork composer 未挂载，可选缺口 |
| 导出 | buildTranscriptExport（JSON/markdown） | fork 的 exportToMarkdown/downloadHTML 够用，暂不换 |

## 三、oxlint 对齐（18ea04e）

- `boundaries/dependencies`、`boundaries/no-unknown`、`no-restricted-imports` 全部恢复 **error**，与上游逐字一致。
- 修复方式：跨模块导入走 barrel（provider-auth 补类型出口、chat barrel 补 `setNotificationSoundEnabled`，MermaidDiagram/usePaletteOps/useAuth/useTasksSettings/PluginSettingsTab 改走模块出口）；`safeLocalStorage` 上移 `shared/utils.ts`（chatStorage re-export 兼容）；fork interface 全转 `type`；相对导入清零改 `@/`。
- 结果：**0 errors**（204 warnings 为上游同级风格提示）。

## 四、合并后回归修复

| 问题 | 根因 | 修复 |
|---|---|---|
| agents 设置列表没有 zcode/antigravity | `useProviderAuthStatus` 的 `CLI_PROVIDERS` 只查 4 家 → 两家 `installed` 恒 false 被"按安装状态隐藏"过滤 | CLI_PROVIDERS 补齐 6 家 |
| agents 列表缺 antigravity（第二处） | `settings/constants` 的 `AGENT_PROVIDERS` 漏 antigravity | 补齐 6 家 |
| 新会话选模型没有两家 | `shared/selectedProvider.ts` 的 `PROVIDERS` 校验表只认 4 家 → 存储的 zcode/antigravity 被打回 claude | 补齐 6 家 |

## 五、手验清单（自动化覆盖不到）

- 设置 → Agents：zcode / antigravity 卡片显示安装与登录状态。
- 新会话：provider 切换可选中 zcode / antigravity，模型目录随 provider 变化。
- 消息编辑 / fork 入口（上游功能）与 fork 渲染管线的配合。
- 定时消息入口（上游功能，未挂载到 fork composer——如需启用另行立项）。
