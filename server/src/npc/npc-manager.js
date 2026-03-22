// NPC 管理器
// 负责 NPC 玩家的生命周期管理：注册、行为调度、清理

const { NPC_PROFILES, NPC_ENABLED } = require('./npc-config');
const { NpcBehavior } = require('./npc-behavior');

class NpcManager {
  constructor(worldEngine) {
    this.engine = worldEngine;
    this.npcs = new Map(); // npcId → { config, behavior, timer }
    this.running = false;
  }

  /**
   * 启动所有 NPC（服务器初始化时调用）
   */
  start() {
    if (!NPC_ENABLED) {
      console.log('🤖 NPC 系统已禁用 (ALICIZATION_TOWN_NPC_ENABLED=false)');
      return;
    }

    console.log(`🤖 正在初始化 ${NPC_PROFILES.length} 个常驻 NPC...`);
    this.running = true;

    for (const config of NPC_PROFILES) {
      this._spawnNpc(config);
    }

    console.log(`🤖 ${this.npcs.size} 个 NPC 已上线`);
  }

  /**
   * 生成单个 NPC
   */
  _spawnNpc(config) {
    // 通过 WorldEngine 内部 API 直接加入，无需 HTTP 认证
    const player = this.engine.join(config.id, config.name, config.sprite, {
      trackActivity: true,
    });

    // 标记为 NPC
    player.isNPC = true;

    // 设置出生点（覆盖默认 5,5）
    if (config.spawnX !== undefined && config.spawnY !== undefined) {
      player.x = config.spawnX;
      player.y = config.spawnY;
    }
    // 触发一次移动来更新区域信息（走1步再走回来的效果通过直接move实现）
    this.engine.move(config.id, 'S', 1);
    this.engine.move(config.id, 'N', 1);

    // 创建行为引擎
    const behavior = new NpcBehavior(config, this.engine);

    // 启动行为定时器（随机间隔）
    const timer = this._scheduleNextAction(config, behavior);

    this.npcs.set(config.id, { config, behavior, timer });
    console.log(`  ✅ ${config.name} (${config.sprite}) 出现在 (${player.x}, ${player.y})`);
  }

  /**
   * 调度下一次 NPC 行为
   */
  _scheduleNextAction(config, behavior) {
    if (!this.running) return null;

    const delay = config.actionIntervalMin +
      Math.floor(Math.random() * (config.actionIntervalMax - config.actionIntervalMin));

    const timer = setTimeout(() => {
      if (!this.running) return;
      try {
        behavior.tick();
        behavior.cleanupGreetHistory();
      } catch (err) {
        console.error(`🤖 NPC ${config.name} 行为异常:`, err.message);
      }
      // 递归调度下一次
      const entry = this.npcs.get(config.id);
      if (entry) {
        entry.timer = this._scheduleNextAction(config, behavior);
      }
    }, delay);

    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  /**
   * 停止所有 NPC（服务器关闭时调用）
   */
  stop() {
    this.running = false;
    console.log('🤖 正在清理 NPC...');
    for (const [npcId, entry] of this.npcs) {
      if (entry.timer) clearTimeout(entry.timer);
      this.engine.removePlayer(npcId);
    }
    this.npcs.clear();
    console.log('🤖 所有 NPC 已下线');
  }

  /**
   * 获取所有 NPC 的状态信息
   */
  getNpcList() {
    const result = [];
    const allPlayers = this.engine.getAllPlayers();
    for (const [npcId, entry] of this.npcs) {
      const player = allPlayers[npcId];
      if (!player) continue;
      result.push({
        id: npcId,
        name: entry.config.name,
        sprite: entry.config.sprite,
        personality: entry.config.personality,
        x: player.x,
        y: player.y,
        zone: player.currentZoneName,
        isNPC: true,
        presenceState: 'active',
      });
    }
    return result;
  }

  /**
   * 检查一个玩家 ID 是否为 NPC
   */
  isNpc(playerId) {
    return this.npcs.has(playerId);
  }
}

module.exports = { NpcManager };
