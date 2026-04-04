# feat: 剧本杀×鹅鸭杀 混血玩法插件 — 核心引擎

## 这是什么

为 Alicization Town 像素沙盒新增 **剧本杀 + 鹅鸭杀混血** 玩法插件。

这不是一个随便嵌入的小游戏。它是对"AI NPC 能不能玩社交推理"这个问题的一次完整验证：

- 3 阵营（侦探方 / 凶手方 / 中立·渡渡鸟）× 7 种角色能力
- 实时行动阶段 + 轮制会议投票 × 3 轮循环
- 12 片证据碎片分散在 4 个地点，调查与信息差是核心机制
- AI 角色具有**性格差异化**的说话风格——不同性格特征映射到不同的语言指令
- **纯 AI 对局观战（spectate）模式**——全程 autorun，通过 SSE 实时推送，观众可以看 AI 互相博弈
- SSE 推送带**视角过滤安全机制**——游戏中隐藏敏感信息，仅在揭晓阶段完整展示

## 为什么做这个

目前 AI 社交推理赛道（狼人杀/剧本杀）的开源项目大致分三类：

| 类型 | 代表 | 局限 |
|---|---|---|
| 纯 AI 对战竞技场 | wolfcha (558⭐), nightfall-ai-arena | 没有世界、没有空间、只有对话框 |
| 叙事驱动单人体验 | ai-murder-mystery, infinite-echoes | 没有实时性、没有观众、没有像素世界 |
| Web3 / 链上 | ShadowPack | 重经济不重叙事 |

**Alicization Town 是唯一一个把社交推理嵌入像素沙盒世界的项目**——角色有空间位置、有行走路径、有表情动画 hint，不只是文本框里的名字。

## 这次改了什么

### 新增文件

| 路径 | 说明 |
|---|---|
| `packages/town-plugin-murder/` | 完整插件目录 |
| `src/engine.js` | 手动状态机引擎，10 个 GamePhase |
| `src/game-state.js` | 状态定义、角色/阵营/阶段枚举 |
| `src/skills.js` | 7 种角色技能执行 |
| `src/prompts/index.js` | LLM prompt 模板 + 16 种性格行为映射 |
| `src/scripts/midnight-manor.js` | 4 人剧本 "午夜庄园谋杀案" |
| `src/scripts/script.schema.json` | JSON Schema (draft-07) 剧本格式规范 |
| `src/index.js` | 9 条 HTTP 路由 + SSE 流 + 观战 autorun |
| `src/memory/` | 向量记忆占位（embedding 接口） |
| `src/llm/` | LLM 抽象层 |
| `README.md` | 完整 Quickstart |
| `docs/design-script-murder-technical.md` | 技术设计文档 |
| `docs/proposal-script-murder-core-changes.md` | 需求提案 |

### 修改的已有文件

| 路径 | 改动 |
|---|---|
| `server/src/main.js` | 注册 murder 插件 |
| `package-lock.json` | 新增依赖 |

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 状态机 | 手动 phase-based | 移除 LangGraph 避免重依赖 + peer dep 冲突 |
| 实时通信 | SSE (纯插件) | 插件无法访问 Socket.IO `io`，SSE 是零依赖方案 |
| SSE 安全 | 视角过滤 | 防止广播泄漏角色/证据等敏感游戏信息 |
| AI 性格 | Trait→说话风格指令映射 | 同模型上实现差异化表现，不需要多模型 |
| 并发保护 | `_autoRunning` Set + guard | 防止 autorun 和手动操作的竞态条件 |
| 表情 hint | `emotion` 字段 + 关键词推理 | 前端未来可渲染表情气泡（本 PR 仅输出 hint） |
| 记忆层 | `@huggingface/transformers` 本地 embedding | 可选依赖，无 API key 也能运行 |

## 局限和 Roadmap

这是一次**玩法探索**，验证"AI + 社交推理 + 像素世界"能不能成立。以下是已知局限：

- **单剧本**：目前只有 "午夜庄园" 4 人局，需要更多剧本贡献
- **无跨局记忆**：游戏结束状态即清除，不像 infinite-echoes 那样有世界线连续性
- **emotion 字段无前端消费**：chatLog 中的 `emotion` 是 hint，等待 game.js 接入
- **LLM 无三层防泄漏**：prompt 是单层角色扮演，竞品 ai-murder-mystery 有 generate→critique→revise
- **无直播集成**：不像 ai-werewolf-live 那样 OBS-ready

欢迎后续有兴趣的同学一起开发，可以从以下方向切入：
1. **新剧本创作** — 只需编写符合 `script.schema.json` 的 JS module
2. **前端表情渲染** — 消费 SSE 中的 `emotion` 字段
3. **多层 prompt 安全** — 防止 AI 角色泄漏角色信息
4. **多人在线** — 多个人类玩家同时加入

## 测试

```bash
npm test                                  # 全量测试
cd packages/mcp-bridge && node --test     # MCP bridge smoke (2/2 pass)
```
