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
| 9 | TaskMaster 静默与脱敏（01fe0c7） | 01fe0c7 | ✅ 完整 | 未配置项目静默横幅在位；MCP 环境变量脱敏在位 |
| 10 | Shell 登录重启 PTY 与终端自动聚焦（b5db838, f8833c1） | b5db838, f8833c1 | ✅ 完整 | 登录命令强制重启 PTY，登录弹窗打开时终端自动聚焦 |
| 11 | Plugins 插件异常防白屏崩溃（1c7237f） | 1c7237f | ✅ 完整 | extractResponseError 错误安全解析，防止 React 渲染树崩溃 |
| 12 | Codex Quota 协议读取与展示（f7a0392 等） | f7a0392, 29847d8 | ✅ 完整 | app-server 协议长连接异步读取额度与展示在位 |

## 二、上游新架构上的替代方案评估

| 领域 | 上游方案 | 结论 |
|---|---|---|
| 滚动稳定 | scrollPositionRef + 手动锚点捕获 | **保留 fork 方案**：原生锚定 + RO 贴底更优，且有量化护航 |
| 流式渲染 | StreamingMarkdown（已删） | 当前转换缓存 + memo 够用；超长流式消息如有重 parse 开销可借鉴其分块思路 |
| Provider 模型选择 | `providerModels` 统一 map + `setProviderModel` | ✅ **已采用上游方案**（18ea04e 后续提交）：6 个 per-provider state + 12 个 props 收敛为单 map + 2 props，6 段重复 reconcile effect 合并为一段；存储键保持 `<provider>-model` 不变，用户既有选择不受影响 |
| 消息编辑/fork | transcriptAnchorId + resolveEditAnchor/rewindSession | ✅ **已修复并打通**：补齐 `useChatMessages` 的 `transcriptAnchorId` 与 `useChatSessionState` 的 `replacesAnchorId`，打通编辑和派生全流程 |
| 定时消息 | ScheduleMessagePopover + ScheduledMessageList + useScheduledMessages | ✅ **已挂载**（da394b6）：composer 工具栏入口 + 待发列表，服务端路由/派发器随合并就位 |
| 导出 | buildTranscriptExport（HTML/Markdown/JSON 统一 API） | ✅ **已采用并补齐**：`buildTranscriptMarkdown` 补齐 ZCode/Antigravity 品牌，支持统一导出与测试 |

## 三、oxlint 对齐（18ea04e）

- `boundaries/dependencies`、`boundaries/no-unknown`、`no-restricted-imports` 全部恢复 **error**，与上游逐字一致。
- 修复方式：跨模块导入走 barrel（provider-auth 补类型出口、chat barrel 补 `setNotificationSoundEnabled`，MermaidDiagram/usePaletteOps/useAuth/useTasksSettings/PluginSettingsTab 改走模块出口）；`safeLocalStorage` 上移 `shared/utils.ts`（chatStorage re-export 兼容）；fork interface 全转 `type`；相对导入清零改 `@/`。
- 结果：**0 errors**（204 warnings 为上游同级风格提示）。

## 四、合并后回归修复与 P0 阻断抢修

| 问题 | 根因 | 修复 |
|---|---|---|
| agents 设置列表没有 zcode/antigravity | `useProviderAuthStatus` 的 `CLI_PROVIDERS` 只查 4 家 → 两家 `installed` 恒 false 被"按安装状态隐藏"过滤 | CLI_PROVIDERS 补齐 6 家 |
| agents 列表缺 antigravity（第二处） | `settings/constants` 的 `AGENT_PROVIDERS` 漏 antigravity | 补齐 6 家 |
| 新会话选模型没有两家 | `shared/selectedProvider.ts` 的 `PROVIDERS` 校验表只认 4 家 → 存储的 zcode/antigravity 被打回 claude | 补齐 6 家 |
| 消息编辑/派生按钮在 UI 上不可见 | `useChatMessages.ts` 的 `convertRow` 漏传 `transcriptAnchorId` | 补齐 `transcriptAnchorId` 透传 |
| 编辑重发新消息瞬间被前端清除 | `useChatSessionState.ts` 的 `chatMessageToNormalized` 漏拷贝 `replacesAnchorId` | 补齐 `replacesAnchorId` 透传 |
| ZCode/Antigravity 自定义模型添加必崩且报假 409 | SQLite `provider_models` 表 CHECK 约束硬编码 4 家，且将 CHECK 约束误判为唯一键冲突 | 放宽约束至 6 家，添加平滑表迁移，精准判定 UNIQUE 冲突 |
| Antigravity 探活同步阻塞主线程 5 秒 | `antigravity-engine-path.ts` 漏配 `eagerVersionProbe: true` 导致调用同步 `spawnSync` | 配置 `eagerVersionProbe: true` 异步预热版本 |
| Dedupe 链跨轮次误吞相同助手回复 | `useSessionStore.ts` 的 `dedupeAdjacentAssistantEchoes` 全局 Map 未在轮次间重置 | 遇到 user 消息时同步清空 `seenAssistantTexts` |
| Markdown 导出助手名称退化为 generic | `buildTranscriptMarkdown.ts` 的 `PROVIDER_LABELS` 漏补两家 | 补齐 `zcode: 'ZCode'` 与 `antigravity: 'Antigravity'` |
| 9 国语言设置侧边栏裸露 `mainTabs.sessions` | 多语言包缺少 sessions 词条且侧边栏无 fallback 兜底 | 补齐 9 国语言包词条并在 `SettingsSidebar` 增加 fallback 兜底 |
| 消息编辑/派生按钮在手机端隐形不可见 | 样式写死 `opacity-0 group-hover:opacity-100`，触屏无 hover 导致永久透明 | 增加响应式 `opacity-70 sm:opacity-0 sm:group-hover:opacity-100` |
| ZCode 思考档位未真正透传（假开关） | `resolveZCodeModelRef` 与 `configureSessionModel` 漏传 `variant` 参数 | 支持读取 effort/variant 并向 `session/setModel` 正确封包透传 |
| 4 家 Provider 缺少 MCP 路径安全校验 | 仅 antigravity/zcode 在子类做检查，基类无防护 | 下沉 `assertPathSecurity` 到 `McpProvider` 基类，全 6 家统一防护防目录穿越 |
| Dedupe 模糊算法任意子串包含有误杀隐患 | `isAssistantTextMatch` 仅靠 `includes`，且无 anchorId 辅助 | 引入 `transcriptAnchorId` 精准定位 turn 边界，文本改用前缀/后缀包含 |
| 遗留孤立死代码 | PR #1206 重构遗留无引用的 `AgentListItem.tsx` | 予以彻底清理删除 |
| 超长会话视口未挂载虚拟化 | `LazyMessageRow` 孤立未接入消息列表 | 在消息数大于 25 时接入 `LazyMessageRow`，活跃末尾 15 条即时挂载 |

## 五、手验清单（自动化覆盖不到）

- 设置 → Agents：zcode / antigravity 卡片显示安装与登录状态。
- 设置 → 终端登录：弹窗关闭后状态自动刷新。
- 新会话：provider 切换可选中 zcode / antigravity，模型目录随 provider 变化。
- 自定义模型：在模型库中添加 zcode / antigravity 模型，成功入库生效。
- 消息编辑 / fork：用户消息右上角编辑与派生按钮正常展示，移动端触屏正常可见，编辑重发顺畅保留。
- ZCode 思考档位：选择不同 effort 切换，底层正确向 ZCode 引擎发送 `variant` 档位。
- 定时消息入口：composer 工具栏正常弹出调度时间列表。
