# Alicization Town 核心引擎扩展提案

> **提案人**: [你的名字]
> **目标版本**: v0.7.0
> **影响范围**: `core-interfaces` + `server/src/engine/`
> **向后兼容**: ✅ 完全兼容 — 所有新增均为可选接口，现有 API 零变更

---

## 一、背景与动机

Alicization Town v0.6.0 的插件系统已具备良好的扩展能力（`registerInteractions`、`registerRoute`、`registerNpcStrategy` 等），但在开发**多人协作型玩法插件**（如剧本杀、狼人杀、密室逃脱等社交推理游戏）时，发现当前核心引擎缺少以下几个**最小且通用**的基础能力，导致这类插件不得不用 hack 方式绕过引擎限制。

本提案的核心原则是：**改最少的核心代码，解锁最大的插件能力。**

---

## 二、现状分析 — 7 个能力缺口

| # | 缺失能力 | 当前状况 | 插件影响 |
|---|---------|---------|---------|
| 1 | **消息频道/房间** | `chat()` 全局广播，所有玩家看到所有消息 | 剧本杀需要分组私聊、搜证隔离 |
| 2 | **私信/悄悄话** | 不存在 whisper 概念 | 无法实现角色间秘密交换信息 |
| 3 | **玩家数据扩展** | PluginContext 无法给 player 附加自定义数据 | 插件无法存储角色绑定、线索持有等状态 |
| 4 | **阶段/定时器** | 无 FSM 或 turn-based 支持 | 游戏阶段流转需要完全自建 |
| 5 | **自定义事件** | 仅 4 种 WorldEventType | 插件无法发出 `murder:phaseChange` 等自定义事件 |
| 6 | **动态区域** | Zone 静态来自 Tiled 地图 | 无法运行时创建"密室""搜证现场"等临时区域 |
| 7 | **玩家分组** | 所有玩家在同一平面 | 无法将玩家分入不同游戏房间 |

---

## 三、提案方案 — 仅需 2 个核心新增

经过分析，**缺口 4/5/6/7 可以完全在插件层实现**（通过 registerRoute + 插件内部状态管理），只有以下 2 项需要核心支持。其他 5 项留给插件自行处理。

### 3.1 新增接口一：Channel 消息频道

**解决缺口 #1 + #2**

```javascript
// ---- packages/core-interfaces/src/IPluginContext.js 新增 ----

/**
 * 创建消息频道（轻量级消息路由，非聊天室）
 * @param {string} channelId - 频道唯一标识，建议使用 pluginId 前缀如 "murder:room-1"
 * @param {Object} options - 频道选项
 * @param {string[]} options.members - 成员 characterId 列表
 * @param {boolean} [options.persistent=false] - 是否持久化
 * @returns {{ send(msg), broadcast(msg), close() }}
 */
registerChannel(channelId, options) { throw new Error('abstract'); }

/**
 * 获取已存在的频道
 * @param {string} channelId
 * @returns {Channel|null}
 */
getChannel(channelId) { throw new Error('abstract'); }
```

**核心实现（约 40 行）**：

```javascript
// ---- server/src/engine/plugin-context.js 新增 ----

registerChannel(channelId, options) {
  const fullId = `${this._pluginId}:${channelId}`;
  const members = new Set(options.members || []);
  const channel = {
    id: fullId,
    members,
    send(fromId, msg) {
      // 仅 members 内的角色能收到 — 复用现有 perception 发送路径
      for (const memberId of members) {
        if (memberId !== fromId) {
          // 通过现有 eventHandlers 分发
          this._hooks.eventHandlers.forEach(h =>
            h({ type: 'channel_message', channel: fullId, from: fromId, to: memberId, message: msg })
          );
        }
      }
    },
    broadcast(msg) {
      for (const memberId of members) {
        this._hooks.eventHandlers.forEach(h =>
          h({ type: 'channel_message', channel: fullId, to: memberId, message: msg })
        );
      }
    },
    addMember(id) { members.add(id); },
    removeMember(id) { members.delete(id); },
    close() { this._hooks.channels.delete(fullId); }
  };
  // 新增 channels Map 到 _hooks（初始化时添加即可）
  if (!this._hooks.channels) this._hooks.channels = new Map();
  this._hooks.channels.set(fullId, channel);
  return channel;
}

getChannel(channelId) {
  const fullId = `${this._pluginId}:${channelId}`;
  return this._hooks.channels?.get(fullId) || null;
}
```

**影响**: `_hooks` 对象增加一个 `channels` Map 字段，其他模块零变动。

---

### 3.2 新增接口二：PlayerStore 玩家数据扩展

**解决缺口 #3**

```javascript
// ---- packages/core-interfaces/src/IPluginContext.js 新增 ----

/**
 * 获取指定玩家的插件数据存储
 * 每个插件拥有独立命名空间，互不干扰
 * @param {string} characterId
 * @returns {{ get(key), set(key, value), getAll(), clear() }}
 */
getPlayerStore(characterId) { throw new Error('abstract'); }
```

**核心实现（约 20 行）**：

```javascript
// ---- server/src/engine/plugin-context.js 新增 ----

getPlayerStore(characterId) {
  // 存储结构: _hooks.playerStores[pluginId][characterId] = Map
  if (!this._hooks.playerStores) this._hooks.playerStores = {};
  const ns = this._pluginId;
  if (!this._hooks.playerStores[ns]) this._hooks.playerStores[ns] = {};
  if (!this._hooks.playerStores[ns][characterId]) {
    this._hooks.playerStores[ns][characterId] = new Map();
  }
  const store = this._hooks.playerStores[ns][characterId];
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    getAll: () => Object.fromEntries(store),
    delete: (key) => store.delete(key),
    clear: () => store.clear()
  };
}
```

**影响**: `_hooks` 对象增加一个 `playerStores` 字段，其他模块零变动。

---

## 四、变更文件清单

| 文件 | 变更类型 | 行数估计 | 说明 |
|------|---------|---------|------|
| `packages/core-interfaces/src/IPluginContext.js` | 新增方法 | +12 行 | 3 个抽象方法声明 |
| `server/src/engine/plugin-context.js` | 新增实现 | +60 行 | 3 个方法的具体实现 |
| `server/src/engine/plugin-manager.js` | 微调 | +5 行 | `_hooks` 初始化添加 channels / playerStores |
| `packages/core-interfaces/src/events.js` | 新增常量 | +2 行 | `CHANNEL_MESSAGE` 事件类型 |

**总计新增代码: ≈ 80 行**
**修改现有代码: 0 行**
**删除代码: 0 行**

---

## 五、向后兼容性论证

| 验证项 | 结论 |
|--------|------|
| 现有插件能否正常运行？ | ✅ 所有新增都是**可选接口**，不调用则不生效 |
| 现有 API 路由是否受影响？ | ✅ HTTP/WebSocket 路由无变化 |
| IPlugin 接口是否变更？ | ✅ 不变 — 变更只在 IPluginContext |
| MCP Bridge 是否需要修改？ | ✅ 不需要 — Channel 通过事件系统透传 |
| 性能影响？ | ✅ 几乎为零 — 只是 Map 的 get/set，无 I/O |
| SQLite 持久化是否受影响？ | ✅ 不影响 — PlayerStore 默认内存态，持久化可选 |

---

## 六、这些改动能解锁什么？

有了 Channel + PlayerStore，以下**所有功能都可以纯插件实现**，无需再动核心：

| 功能 | 实现方式 |
|------|---------|
| 🎭 剧本杀 游戏（阶段FSM + 角色绑定 + 搜证 + 投票） | 插件内 FSM + PlayerStore 存角色/线索 + Channel 隔离对话 |
| 🐺 狼人杀 | 同上 + Channel 区分白天/夜晚 |
| 🔐 密室逃脱 | PlayerStore 存道具 + Channel 分组 |
| 💬 私信系统 | Channel(members=[A, B]) 即为私信 |
| 🏠 房间/公会系统 | Channel + PlayerStore 组合 |
| 🎪 活动/任务系统 | PlayerStore 存进度 + Channel 推送 |
| 🧠 性格/MBTI 系统 | PlayerStore 存人格数据 |

**一次投入 80 行代码，解锁整个社交游戏生态。**

---

## 七、替代方案对比

| 方案 | 核心改动量 | 缺点 |
|------|-----------|------|
| **A. 本提案（Channel + PlayerStore）** | ~80 行，纯新增 | — |
| B. 全在插件里用 registerRoute 模拟 | 0 行核心改动 | 插件需要 hack 消息路由，无法与 perception 系统集成，MCP bridge 看不到频道消息 |
| C. 大改核心加入完整房间系统 | ~500+ 行，改动广泛 | 过度工程，破坏现有 API |
| D. Fork 独立分支 | 0 | 无法合并回主线，维护成本高 |

---

## 八、时间线建议

| 阶段 | 内容 | 预期 |
|------|------|------|
| Phase 1 | PR 核心接口（本提案内容） | 代码 Review + 测试 |
| Phase 2 | 发布 `town-plugin-personality`（MBTI 性格插件） | 验证 PlayerStore |
| Phase 3 | 发布 `town-plugin-murder` MVP（固定剧本 + 3 阶段核心循环） | 验证 Channel + FSM |
| Phase 4 | 社区反馈迭代 | 完善 API |

---

## 九、参考项目

- **Stanford Generative Agents (21k★)**: 记忆流架构（observation→retrieve→reflect→plan）— 我们的性格/记忆系统参考其三维评分检索方案
- **jubensha-ai (87★)**: 剧本杀 8 阶段 FSM + 对话流控制器 — 验证了"搜证→讨论→投票"核心循环的可行性
- **Wolfcha (558★)**: 双层角色扮演（人格层 + 游戏角色层）— 与 Alicization Town 的"小镇人格 + 游戏角色"天然对齐
- **arXiv:2309.04658**: 学术验证 LLM 可通过检索+反思在社交推理游戏中展现策略行为

---

## 十、总结

这是一个**最小侵入、最大收益**的核心扩展提案。80 行纯新增代码，零破坏性变更，为 Alicization Town 打开从"AI 小镇散步聊天"到"AI 小镇社交游戏平台"的大门。

期待讨论！

---

*附：如需查看详细的技术设计文档（Prompt 工程架构、记忆系统设计、剧本数据格式标准），可另行提供。*
