# feat: 剧本杀×鹅鸭杀 混血玩法插件 — 核心引擎 + MCP/CLI 工具链

## Background

Alicization Town 当前是一个 AI 驱动的像素沙盒世界，NPC 能闲聊、能移动、有感知范围，但缺乏结构化的多人博弈玩法。

本 PR 为世界新增一个**剧本杀 + 鹅鸭杀混血**玩法插件，验证 "AI NPC 在像素世界里玩社交推理"这个方向是否成立。插件以 `IPlugin` 标准接口注册，不侵入核心 world-engine。同时在 MCP Bridge 和 town-cli 两条标准接入通道上补齐操控能力。

## Solution Overview

整个剧本杀系统通过单一插件包 `packages/town-plugin-murder/` 实现，不引入新的 prompt 框架或外部编排库。

包含：

- 手动状态机引擎，管理 10 阶段游戏循环（SETUP→PROLOGUE→3×ACTION/MEETING→REVELATION→ENDED）
- 3 阵营（detective/killer/neutral）× 7 角色技能系统
- 证据碎片化：12 片碎片分散在 4 地点，搜查获取，可伪造
- AI 性格差异化：16 种性格 trait → 具体说话风格指令映射，同一 LLM 模型上产生不同角色表现
- 纯 AI 对局观战（autorun）模式：SSE 实时推送 + 视角安全过滤
- LLM provider 抽象层，支持 OpenAI/DeepSeek/Anthropic，通过环境变量切换
- per-character 向量记忆：`@huggingface/transformers` 本地 embedding（可选依赖）
- 4 人剧本「午夜庄园谋杀案」+ JSON Schema (draft-07) 剧本格式规范
- MCP Bridge: 10 个 murder_* 工具，AI Agent 通过 MCP 协议完整操控游戏
- town-cli: 7 个 murder 子命令，人类玩家通过终端操控

## Data Model

### GamePhase（10 阶段）

```
SETUP → PROLOGUE → ACTION_R1 → MEETING_R1 → ACTION_R2 → MEETING_R2 → ACTION_R3 → FINAL_VOTE → REVELATION → ENDED
```

`PHASE_ORDER` 数组硬编码顺序，`nextPhaseOf()` 线性推进。没有分支跳转——唯一的提前终结路径是胜负条件触发后直接跳至 `REVELATION`。

### Faction 与 RoleId

| RoleId | 阵营 | 名称 | 技能类型 | 限制 |
|---|---|---|---|---|
| `coroner` | detective | 验尸官 | 主动·查验阵营 | ∞次，每轮1次 |
| `bodyguard` | detective | 保镖 | 主动·守护免杀 | ∞次，每轮1次 |
| `tracker` | detective | 跟踪者 | 主动·查行踪 | ∞次，每轮1次 |
| `forger` | killer | 伪证师 | 主动·伪造线索 | 全局2次，每轮1次 |
| `silencer` | killer | 消音者 | 主动·禁言 | 全局1次，每轮1次 |
| `eliminator` | killer | 灭迹者 | 被动·击杀不留尸 | — |
| `dodo` | neutral | 渡渡鸟 | 被动·被放逐即胜 | — |

每个角色有 `skillUsedThisRound` 和 `totalSkillUses` 两级计数。`canUseSkill()` 检查：非被动 → 本轮未满 `perRound` → 累计未满 `maxUses`。

### State 结构（`createInitialState` 输出）

```js
{
  gameId, phase, script, characters, humanCharacterId,
  roles,                     // { charId: { roleId, faction, skillUsedThisRound, totalSkillUses } }
  chatLog,                   // [{ speaker, characterId, content, phase, round, timestamp, emotion }]
  evidenceFragments,         // 完整碎片池（含伪造碎片）
  playerEvidence,            // { charId: [fragmentId, ...] } 私有证据
  killedCharacters,          // [{ characterId, killedBy, round, visible, timestamp }]
  protectedCharacterId,      // 本轮保镖守护目标
  silencedCharacterId,       // 下轮会议禁言目标
  actionLog,                 // [{ characterId, action, location, round, ts }]
  meetingVotes,              // { voterId: votedCharId | null }
  accusationHeat,            // { charId: number } 累积嫌疑热度
  currentSpeaker, waitingForHuman, humanInput, result
}
```

### Evidence Fragment Schema

每个碎片属于一条 evidence（`evidenceId`），有 `pieceIndex/totalPieces` 标记完整度。搜查返回第一个本角色未持有的碎片（FIFO）。伪造碎片（`isForged: true`）混入同一池，对其他角色不可区分。

## Algorithm And Rules

### 行动阶段（_runActionPhase）

1. 清除保镖守护 + 重置本轮技能计数
2. 收集所有 AI 角色 → **`Promise.all` 并行**发送 LLM 请求
3. **串行**应用决策到 state（避免竞态写入）
4. AI 可选行动：`search`（搜证）、`skill`（使用技能）、`kill`（击杀）、`wait`

### 击杀判定（processKillAttempt）

```
if (目标被保镖守护) → 击杀失败
if (凶手是灭迹者) → visible = false (不留尸体)
else → visible = true → 下轮会议公布
```

### 会议阶段（_runMeetingPhase → _runVoting）

1. 公布新遇害者名单
2. 轮流发言（被消音者 → 跳过输出"……（被消音，无法发言）"）
3. 投票：支持弃票；`_resolveVotes` 计数排序
4. **平票 → 重投一次**→ 仍平票 → 无人被放逐（凶手有利）
5. 渡渡鸟被放逐 → 中立方胜利（提前结束）
6. 凶手方核心（eliminator）被放逐 → 侦探方胜利
7. 侦探方存活 < 2 → 凶手方胜利
8. 最终投票轮仍未投出凶手 → 凶手方胜利
9. 每轮投票后 accusationHeat 衰减

### 超时机制

`_handleTimeout()` 检查 `lastHeartbeatAt`，超过 `timeoutMs`（默认5分钟）则将人类玩家切换为 AI 接管。

## AI Personality Differentiation

竞品（如 ShadowPack）通过不同 temperature 或不同模型实现角色差异。本实现在 **同一模型** 上通过 prompt 指令实现：

```
TRAIT_STYLE: { '冲动': '语气急促，爱用感叹号和反问...', '冷静': '说话不急不缓...' }
```

16 种 trait → 具体说话方式指令。`buildPersonalityDirective(traits)` 将角色的 `personalityTraits` 数组翻译为编号指令列表，注入 system prompt。

### Emotion Hint

`makeLine()` 生成聊天条目时，通过 `inferEmotion()` 做关键词匹配（9 类情感词组），输出 `emotion` 字段。该字段作为 hint 供前端渲染表情气泡，当前无前端消费方。

## SSE Broadcast And Security

### 广播路径

`_broadcast(gameId, event)` → `_sanitizeEvent()` → SSE `text/event-stream` 推送

### 视角过滤规则（_sanitizeStateEvent）

游戏进行中（非 REVELATION/ENDED）：从 `stateUpdate` 中 **剥离以下 6 个字段**：

- `roles` — 阵营/角色身份
- `protectedCharacterId` — 保镖守护目标
- `silencedCharacterId` — 消音目标
- `actionLog` — 行动日志
- `evidenceFragments` — 完整碎片池
- `playerEvidence` — 仅保留人类玩家自己的

游戏结束后：完整暴露 `roles` 和 `playerEvidence`。

`skill` / `kill` / `search` 事件仅广播 `{ type, timestamp }`，不暴露具体参数。

### 并发保护（Autorun）

`_autoRunning` Set 记录当前自动运行的 gameId。`step/useSkill/attemptKill/searchLocation/submitHumanInput` 入口全部检查此 Set，防止观战模式下手动操作竞态。

## Plugin Integration

`server/src/main.js` 处唯一改动：注册插件到 PluginManager。

```js
pluginManager.register(new TownPluginMurder());
```

插件通过 `ctx.registerRoute()` 注册 9 条 HTTP 路由（前缀 `/api/plugins/murder/`），通过 `ctx.onEvent()` 挂载事件监听（当前 MVP 不做自动触发，仅占位）。

### HTTP Routes

| Method | Path | 说明 |
|---|---|---|
| POST | `/murder/games` | 创建游戏局 |
| POST | `/murder/games/:gameId/step` | 推进一个阶段 |
| POST | `/murder/games/:gameId/input` | 提交人类输入 |
| GET | `/murder/games/:gameId` | 查询状态 |
| POST | `/murder/games/:gameId/skill` | 使用角色技能 |
| POST | `/murder/games/:gameId/kill` | 凶手击杀 |
| POST | `/murder/games/:gameId/search` | 搜查地点 |
| GET | `/murder/games/:gameId/stream` | SSE 事件流 |
| POST | `/murder/games/:gameId/autorun` | 启动纯 AI 观战 |

## LLM Provider Layer

`src/llm/provider.js` 通过环境变量确定 provider：

```
MURDER_LLM_PROVIDER=openai|anthropic|deepseek (默认 openai)
MURDER_LLM_MODEL=gpt-4o-mini (默认)
MURDER_LLM_API_KEY=<key>
MURDER_LLM_BASE_URL=<custom endpoint>
```

使用 `@langchain/openai` (optionalDependency) 或 `@langchain/anthropic` (optionalDependency)。包未安装时抛出友好错误提示安装命令。

**LangGraph 已完全移除**——之前的实现依赖 `@langchain/langgraph`，存在 peer dep 冲突和约 2MB 包体积。改为手动 phase-based 状态机后零编排依赖。

## Memory Layer

`src/memory/associative-memory.js` 提供 per-character 向量记忆：

- `add(memory)` → 生成 embedding → 存入内存数组
- `retrieve(query, { topK })` → 余弦相似度排序取 topK
- embedding via `@huggingface/transformers` all-MiniLM-L6-v2（可选依赖，未安装时 fallback 到随机向量——仅用于保证不报错，无实际语义能力）

当前 embedding 仅用于 AI 决策时的 6 条记忆召回，不外部暴露。

## Script Format

`src/scripts/script.schema.json` (JSON Schema draft-07) 定义剧本模块接口：

- `characters[]`: id, name, age, profession, roleId, personalityTraits, background, secret, objective
- `locations[]`: id, name, searchableItems
- `evidenceFragments[]`: fragmentId, evidenceId, pieceIndex, totalPieces, name, locationId, description, isForged
- `truth`: murdererId, firstVictimId, victimName, summary

编写新剧本只需创建符合 schema 的 JS module 并导出。

## MCP Bridge — 工具链

### 注册方式

`packages/mcp-bridge/src/tools/murder.js` 导出 `definitions[]` 和 `handlers{}`。在 `src/index.js` 中通过 `tools.push(...definitions)` 注册，在 `handleToolCall` 中路由。

### 工具清单

| Tool | readOnly | 参数 | Server 端点 | 说明 |
|---|---|---|---|---|
| `murder_create` | ❌ | gameId?, humanCharacterId? | POST /murder/games | 创建游戏局 |
| `murder_step` | ❌ | gameId | POST /murder/games/:id/step | 推进一个阶段 |
| `murder_status` | ✅ | gameId | GET /murder/games/:id | 查询状态 |
| `murder_input` | ❌ | gameId, input | POST /murder/games/:id/input | 提交通用输入 |
| `murder_speak` | ❌ | gameId, text | POST /murder/games/:id/input | 便捷发言 |
| `murder_vote` | ❌ | gameId, target, reason? | POST /murder/games/:id/input | 便捷投票 |
| `murder_search` | ❌ | gameId, location | POST /murder/games/:id/search | 搜查地点 |
| `murder_skill` | ❌ | gameId, characterId, target | POST /murder/games/:id/skill | 使用技能 |
| `murder_kill` | ❌ | gameId, killerId, targetId | POST /murder/games/:id/kill | 凶手击杀 |
| `murder_autorun` | ❌ | gameId | POST /murder/games/:id/autorun | 启动纯 AI 观战 |

handler 返回前通过 `formatState(state)` 将 state 转为可读文本（不暴露 roles 等敏感字段，与 SSE 安全策略一致）。

### client.js 新增方法

`murderUseSkill`, `murderAttemptKill`, `murderSearchLocation`, `murderAutoRun` — 基础 CRUD 复用 `pluginRequest()`。

## CLI — 子命令结构

`packages/town-cli/src/lib/murder.js` 导出 `murderCommand(args, client)` 函数，在 `town.js` 主入口中注册为 `murder` 子命令。

| 命令 | 说明 |
|---|---|
| `town murder create [gameId]` | 创建游戏局 |
| `town murder step <gameId>` | 推进一步 |
| `town murder input <gameId> <text>` | 提交文本输入 |
| `town murder status <gameId>` | 查询当前状态 |
| `town murder skill <gameId> <charId> <target>` | 使用技能 |
| `town murder kill <gameId> <killerId> <targetId>` | 凶手击杀 |
| `town murder search <gameId> <location>` | 搜查地点 |

## Files Changed

### New Files (18)

| Path | Lines | Description |
|---|---|---|
| `packages/town-plugin-murder/package.json` | 26 | 插件包声明 |
| `packages/town-plugin-murder/README.md` | 220 | 完整 Quickstart 文档 |
| `packages/town-plugin-murder/src/game-state.js` | 157 | 状态定义、枚举、helpers |
| `packages/town-plugin-murder/src/skills.js` | 183 | 7 角色技能执行逻辑 |
| `packages/town-plugin-murder/src/engine.js` | 676 | 状态机引擎核心 |
| `packages/town-plugin-murder/src/index.js` | 352 | 插件入口、HTTP路由、SSE |
| `packages/town-plugin-murder/src/prompts/index.js` | 134 | LLM prompt 模板 + trait 映射 |
| `packages/town-plugin-murder/src/scripts/midnight-manor.js` | 107 | 4人剧本 |
| `packages/town-plugin-murder/src/scripts/script.schema.json` | 136 | 剧本 JSON Schema |
| `packages/town-plugin-murder/src/llm/provider.js` | 94 | LLM provider 抽象 |
| `packages/town-plugin-murder/src/memory/associative-memory.js` | 121 | 向量记忆 |
| `packages/town-plugin-murder/src/memory/embedding.js` | 94 | embedding 抽象 |
| `packages/mcp-bridge/src/tools/murder.js` | 296 | 10 个 MCP 工具定义 + handler |
| `packages/town-cli/src/lib/murder.js` | 219 | CLI murder 子命令组 |
| `docs/design-script-murder-technical.md` | 936 | 技术设计文档 |
| `docs/proposal-script-murder-core-changes.md` | 239 | 需求提案 |
| `docs/pr-murder-core.md` | — | 本 PR 描述 |
| `docs/pr-murder-mcp-cli.md` | — | MCP/CLI 部分描述 |

### Modified Files (6)

| Path | Change |
|---|---|
| `server/src/main.js` | +22/-0 注册 murder 插件到 PluginManager |
| `packages/mcp-bridge/src/client.js` | +46 新增 4 个 client 方法 |
| `packages/mcp-bridge/src/index.js` | +12/-2 注册 murder tools + 路由 handler |
| `packages/mcp-bridge/test/smoke.test.js` | +1/-1 expectedTools 从 10 更新为 20 |
| `packages/town-cli/src/town.js` | +18/-4 注册 murder 子命令 |
| `package-lock.json` | +1651 新增依赖树 |

## Test Results

```bash
cd packages/mcp-bridge && node --test
# ✔ smoke.test.js — 20 tools registered (pass)
# ✔ compat.test.js (pass)

cd packages/town-cli && node --test
# ✔ smoke.test.js (pass)
```

`npm install` 成功（222 packages）。无新的 lint 错误。

## Uncovered Risks

| 风险 | 严重度 | 说明 |
|---|---|---|
| LLM 角色泄漏 | 🔴 | 当前 prompt 是单层角色扮演。AI 可能被对手引导说出秘密。竞品 ai-murder-mystery 有 generate→critique→revise 三层防护。 |
| 单剧本 | 🟡 | 只有「午夜庄园」4人局，无法验证引擎对不同人数/角色配比的泛化能力。 |
| 无跨局记忆 | 🟡 | 游戏结束即清除所有状态。不像 infinite-echoes 有世界线连续性。 |
| embedding fallback | 🟡 | `@huggingface/transformers` 未安装时 fallback 随机向量，记忆检索等于随机。不报错但无效。 |
| MCP handler 无 input validation | 🟡 | MCP 层参数直接透传到 HTTP API，依赖 server 端校验。无额外 schema 验证。 |
| emotion 无前端消费 | 🟠 | chatLog 中 `emotion` 字段目前无人读取，等待 `game.js` 接入。 |
| chatLog 无限增长 | 🟠 | 长局 chatLog 会持续膨胀，无上限截断。对 LLM 上下文窗口有影响（通过 `tail()` 取最近 N 条缓解，但 state 本身不缩减）。 |
| SSE 无认证 | 🟠 | `/murder/games/:gameId/stream` 不需要 session，任何知道 gameId 的人可连接。视角过滤阻止了信息泄露，但可被用于 DoS。 |
| formatState 与 core 耦合 | 🟠 | MCP/CLI 的 `formatState` 直接读 state 字段名，core 变更字段名会导致格式化错误。无自动化检测。 |
