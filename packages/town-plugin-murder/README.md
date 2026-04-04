# 🕵️ town-plugin-murder — 剧本杀 × 鹅鸭杀 混血插件

AI 驱动的社交推理游戏插件，为 Alicization Town 提供剧本杀玩法。

## Quickstart — 5 分钟跑起来

### 1. 安装依赖

```bash
# 在项目根目录
npm install

# 安装 LLM Provider（按需二选一）
npm install @langchain/openai          # OpenAI / 兼容 API
# 或
npm install @langchain/anthropic       # Claude
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件（或直接 export）：

```env
# === 必填 ===
MURDER_LLM_PROVIDER=openai            # openai | anthropic
MURDER_LLM_API_KEY=sk-xxxxxxxx        # 你的 API Key

# === 可选 ===
MURDER_LLM_MODEL=gpt-4o-mini          # 默认 gpt-4o-mini / claude-sonnet-4-20250514
MURDER_LLM_BASE_URL=                   # 自定义 API 地址（兼容 OpenAI 格式的中转）
MURDER_HUMAN_TIMEOUT_MS=300000         # 等待玩家输入超时（毫秒，默认 5 分钟）
```

### 3. 启用插件

确保服务器启动时加载了本插件。在服务器环境变量中设置：

```env
ALICIZATION_PLUGINS=town-plugin-murder
```

然后启动服务器：

```bash
npm start
# 或
node server/src/main.js
```

看到终端输出 `🕵️ 剧本杀插件已注册` 表示插件加载成功。

### 4. 开始游戏

所有 API 前缀：`/api/plugins/murder`

#### 4.1 创建游戏

```bash
curl -X POST http://localhost:3000/api/plugins/murder/games \
  -H "Content-Type: application/json" \
  -d '{"gameId": "my_first_game", "humanCharacterId": "char_qin_feng"}'
```

- `gameId`：可选，不传自动生成
- `humanCharacterId`：你扮演的角色 ID（见下方角色表），不传则全 AI 托管

#### 4.2 推进游戏

```bash
curl -X POST http://localhost:3000/api/plugins/murder/games/my_first_game/step
```

每次调用推进一个阶段。阶段顺序：

```
序幕 → 行动1 → 会议1 → 投票1 → 行动2 → 会议2 → 投票2 → 行动3 → 会议3 → 投票3 → 结局
```

#### 4.3 玩家互动（当轮到你时）

当 `state.waitingForHuman === true` 时，提交你的输入：

```bash
curl -X POST http://localhost:3000/api/plugins/murder/games/my_first_game/input \
  -H "Content-Type: application/json" \
  -d '{"input": "我怀疑林雅有嫌疑，因为她在案发时间没有不在场证明"}'
```

#### 4.4 使用技能（行动阶段）

```bash
curl -X POST http://localhost:3000/api/plugins/murder/games/my_first_game/skill \
  -H "Content-Type: application/json" \
  -d '{"characterId": "char_qin_feng", "target": "char_lin_ya"}'
```

#### 4.5 搜证（行动阶段）

```bash
curl -X POST http://localhost:3000/api/plugins/murder/games/my_first_game/search \
  -H "Content-Type: application/json" \
  -d '{"characterId": "char_qin_feng", "location": "酒窖"}'
```

#### 4.6 查看当前状态

```bash
curl http://localhost:3000/api/plugins/murder/games/my_first_game
```

### 5. 实时事件流（SSE）

前端可订阅游戏事件，无需轮询：

```javascript
const es = new EventSource('/api/plugins/murder/games/my_first_game/stream');
es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  console.log(event);
  // { type: 'stateUpdate', state: {...} }  — 阶段推进
  // { type: 'skill', timestamp: ... }       — 有人使用了技能
  // { type: 'kill', timestamp: ... }        — 有人发起了击杀
  // { type: 'search', timestamp: ... }      — 有人搜证了
  // { type: 'gameEnd', result: {...} }      — 游戏结束
};
```

> **安全策略**：SSE 推送会自动过滤敏感信息（角色身份、他人证据、保护/禁言目标），仅在游戏结束后才暴露完整数据。

### 6. 纯 AI 观战模式（AI Arena）

不想亲自参与？让 AI 互相厮杀，你看戏就行：

```bash
# 1. 先订阅 SSE 流（浏览器或 curl）
curl -N http://localhost:3000/api/plugins/murder/games/arena_01/stream

# 2. 另一个终端启动观战游戏
curl -X POST http://localhost:3000/api/plugins/murder/games/arena_01/autorun
```

观战模式特点：
- 所有 4 个角色都由 AI 控制（`humanCharacterId = null`）
- 自动推进全部 11 个阶段，每阶段间隔 2 秒
- SSE 实时推送每个阶段的（脱敏后）状态
- 游戏结束后推送完整角色揭示

---

## 角色表（午夜庄园剧本）

| ID | 名字 | 角色 | 阵营 | 技能 |
|----|------|------|------|------|
| `char_lin_ya` | 林雅 | 灭迹者 (Eliminator) | 🔴 杀手 | 击杀（全局 1 次），被动：隐形击杀不留线索 |
| `char_luo_chen` | 罗辰 | 消音者 (Silencer) | 🔴 杀手 | 禁言目标 1 回合 |
| `char_qin_feng` | 秦枫 | 验尸官 (Coroner) | 🔵 侦探 | 验一个角色阵营 |
| `char_su_wan` | 苏婉 | 渡渡鸟 (DoDo) | 🟡 中立 | 伪装被保护，胜利条件：自己被投票放逐 |

## 游戏规则速览

- **3 轮制**：每轮 = 行动 + 会议 + 投票
- **行动阶段**：搜证 / 使用技能 / 击杀（杀手限定）
- **会议阶段**：AI 角色自动发言，玩家等待输入
- **投票阶段**：票数最高者被放逐；平票时有 1 次重投机会，仍平则跳过（杀手优势）
- **胜利条件**：
  - 🔵 侦探：投票放逐凶手（灭迹者）
  - 🔴 杀手：3 轮结束未被放逐，或侦探阵营剩余 < 2
  - 🟡 渡渡鸟：自己被投票放逐

## CLI 使用

如果你安装了 `town-cli`，也可以用命令行操作：

```bash
town murder create --human char_qin_feng
town murder step
town murder input "我觉得林雅很可疑"
town murder skill --char char_qin_feng --target char_lin_ya
town murder kill --killer char_lin_ya --target char_qin_feng
town murder search --char char_qin_feng --location 酒窖
town murder status
```

## MCP Bridge

通过 MCP 协议调用（适用于 AI Agent）：

```
murder_create   → 创建游戏
murder_step     → 推进阶段
murder_input    → 提交发言
murder_skill    → 使用技能
murder_kill     → 执行击杀
murder_search   → 搜证
murder_status   → 查看状态
murder_vote     → 投票
murder_accuse   → 指控
murder_autorun  → 纯 AI 观战模式
```

## 自定义剧本

剧本格式参见 [script.schema.json](src/scripts/script.schema.json)。

在 `src/scripts/` 下创建新的 `.js` 文件，导出符合 schema 的剧本对象即可。

## 技术架构

```
index.js          ← 插件入口，HTTP 路由 + SSE
  └── engine.js   ← 游戏引擎，阶段状态机
        ├── game-state.js  ← 状态定义 + 角色/阵营
        ├── skills.js      ← 7 角色技能逻辑
        └── prompts/       ← LLM Prompt 模板
```

## 环境要求

- Node.js >= 22.5
- 至少一个 LLM API Key（OpenAI 或 Anthropic）
