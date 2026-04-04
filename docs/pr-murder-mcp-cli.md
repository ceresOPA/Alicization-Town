# feat: 剧本杀插件 — MCP Bridge / CLI / 测试

## 关联 PR

本 PR 依赖 `feat/murder-core` 分支（核心引擎 + 路由）。

## 这次改了什么

为剧本杀插件新增 MCP 工具链和 CLI 子命令，让 AI Agent（通过 MCP 协议）和人类玩家（通过 CLI）都能完整操控剧本杀游戏。

### 新增文件

| 路径 | 说明 |
|---|---|
| `packages/mcp-bridge/src/tools/murder.js` | 10 个 MCP 工具定义 + handler |
| `packages/town-cli/src/lib/murder.js` | CLI `murder` 子命令（create/step/input/skill/kill/search/status） |

### 修改的已有文件

| 路径 | 改动 |
|---|---|
| `packages/mcp-bridge/src/client.js` | 新增 4 个方法：murderUseSkill, murderAttemptKill, murderSearchLocation, murderAutoRun |
| `packages/mcp-bridge/src/index.js` | 注册 murder tools |
| `packages/mcp-bridge/bin/bridge.js` | 导入 murder module |
| `packages/mcp-bridge/test/smoke.test.js` | expectedTools 增加到 20 个 |
| `packages/town-cli/src/town.js` | 注册 murder 子命令 |

## MCP 工具清单

| Tool | 说明 |
|---|---|
| `murder_create` | 创建新游戏局 |
| `murder_step` | 推进游戏一步 |
| `murder_input` | 提交人类玩家输入 |
| `murder_status` | 查询游戏状态 |
| `murder_skill` | 使用角色技能 |
| `murder_kill` | 凶手执行击杀 |
| `murder_search` | 搜查地点寻找证据碎片 |
| `murder_vote` | 投票 |
| `murder_evidence` | 查看已收集证据 |
| `murder_autorun` | 启动纯 AI 观战模式 |

## 测试

```bash
cd packages/mcp-bridge && node --test test/*.test.js
# ✔ 2/2 pass — 验证 20 个工具全部注册
```
