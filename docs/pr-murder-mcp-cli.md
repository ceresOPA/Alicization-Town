# feat: 剧本杀插件 — MCP Bridge / CLI 工具链

## 关联 PR

本 PR 依赖 `feat/murder-core` 分支（核心引擎 + 路由）。建议先合并 core 再合并本 PR。

## Background

`feat/murder-core` 添加了 9 条 HTTP 路由，但 AI Agent（通过 MCP 协议）和人类玩家（通过 CLI）目前无法直接操控剧本杀游戏。MCP Bridge 和 town-cli 是 Alicization Town 的两条标准接入通道，本 PR 在这两条通道上补齐剧本杀操作能力。

## Solution Overview

在不修改现有 MCP/CLI 基础架构的前提下，通过已有的 tool 注册机制和子命令机制扩展：

- MCP Bridge: 新增 10 个 murder_* 工具定义 + handler，通过 client.js 调用 server HTTP API
- town-cli: 新增 `murder` 子命令组（7 个子命令），复用 shared/town-client HTTP 层
- 修改量集中在 6 个文件，总计 +587 行

## MCP Tools — 定义与注入路径

### 注册方式

`packages/mcp-bridge/src/tools/murder.js` 导出 `definitions[]` 和 `handlers{}`。在 `src/index.js` 中通过 `tools.push(...definitions)` 注册，在 `handleToolCall` 中路由。

### 工具清单

| Tool | readOnly | 参数 | Server 端点 | 说明 |
|---|---|---|---|---|
| `murder_create` | ❌ | gameId?, humanCharacterId? | POST /murder/games | 创建游戏局 |
| `murder_step` | ❌ | gameId | POST /murder/games/:id/step | 推进一个阶段 |
| `murder_status` | ✅ | gameId | GET /murder/games/:id | 查询状态 |
| `murder_input` | ❌ | gameId, input | POST /murder/games/:id/input | 提交通用输入 |
| `murder_speak` | ❌ | gameId, text | POST /murder/games/:id/input | 便捷发言（包装为 input） |
| `murder_vote` | ❌ | gameId, target, reason? | POST /murder/games/:id/input | 便捷投票 |
| `murder_search` | ❌ | gameId, location, speech? | POST /murder/games/:id/search | 搜查地点 |
| `murder_skill` | ❌ | gameId, characterId, target, description? | POST /murder/games/:id/skill | 使用技能 |
| `murder_kill` | ❌ | gameId, killerId, targetId | POST /murder/games/:id/kill | 凶手击杀 |
| `murder_autorun` | ❌ | gameId | POST /murder/games/:id/autorun | 启动纯 AI 观战 |

所有工具的 `annotations` 标记了 `readOnlyHint`、`destructiveHint`、`openWorldHint`，供 MCP 客户端做 UI hint。

### formatState

handler 返回前通过 `formatState(state)` 将 state 转为可读文本：

- 输出阶段、存活角色、最近 15 条对话、已收集证据、投票结果
- 不暴露 roles / evidenceFragments 等敏感字段（与 SSE 安全策略一致）

### client.js 新增方法

| 方法 | HTTP |
|---|---|
| `murderUseSkill(gameId, characterId, action)` | POST /skill |
| `murderAttemptKill(gameId, killerId, targetId)` | POST /kill |
| `murderSearchLocation(gameId, characterId, location)` | POST /search |
| `murderAutoRun(gameId)` | POST /autorun |

基础 CRUD（create/step/input/status）复用现有 `pluginRequest()` 方法。

## CLI — 子命令结构

`packages/town-cli/src/lib/murder.js` 导出 `murderCommand(args, client)` 函数，在 `town.js` 主入口中注册为 `murder` 子命令。

### 子命令清单

| 命令 | 参数 | 说明 |
|---|---|---|
| `town murder create [gameId]` | --human=charId | 创建游戏局 |
| `town murder step <gameId>` | | 推进一步 |
| `town murder input <gameId> <text>` | | 提交文本输入 |
| `town murder status <gameId>` | | 查询当前状态 |
| `town murder skill <gameId> <charId> <target>` | --desc=text | 使用技能 |
| `town murder kill <gameId> <killerId> <targetId>` | | 凶手击杀 |
| `town murder search <gameId> <location>` | | 搜查地点 |

CLI 输出复用与 MCP 相同的 `formatState` 逻辑。

## Files Changed

### New Files (2)

| Path | Lines | Description |
|---|---|---|
| `packages/mcp-bridge/src/tools/murder.js` | 296 | 10 个 MCP 工具定义 + handler |
| `packages/town-cli/src/lib/murder.js` | 219 | CLI murder 子命令组 |

### Modified Files (4)

| Path | Change |
|---|---|
| `packages/mcp-bridge/src/client.js` | +46 新增 4 个 client 方法 |
| `packages/mcp-bridge/src/index.js` | +12/-2 注册 murder tools + 路由 handler |
| `packages/mcp-bridge/test/smoke.test.js` | +1/-1 expectedTools 从 10 更新为 20 |
| `packages/town-cli/src/town.js` | +18/-4 注册 murder 子命令 |

## Test Results

```bash
cd packages/mcp-bridge && node --test
# ✔ smoke.test.js — 验证 20 个工具全部注册 (pass)
# ✔ compat.test.js (pass)

cd packages/town-cli && node --test
# ✔ smoke.test.js (pass)
```

## Uncovered Risks

| 风险 | 严重度 | 说明 |
|---|---|---|
| MCP handler 无 input validation | 🟡 | 参数直接透传到 HTTP API，依赖 server 端校验。MCP 层未做额外 schema 验证。 |
| CLI 无 autorun 命令 | 🟠 | MCP 有 `murder_autorun` 但 CLI 未暴露，因为 CLI 无法接收 SSE 推送。后续可加 polling 模式。 |
| formatState 与 core 耦合 | 🟠 | `formatState` 直接读 state 字段名，core 变更字段名会导致格式化错误。无自动化检测。 |
