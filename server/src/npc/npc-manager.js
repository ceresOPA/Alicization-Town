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
    const player = this.engine.join(config.id, config.name, config.sprite, {
      trackActivity: true,
    });

    player.isNPC = true;

    if (config.spawnX !== undefined && config.spawnY !== undefined) {
      player.x = config.spawnX;
      player.y = config.spawnY;
    }
    // 更新区域信息以匹配实际坐标
    this.engine.refreshZoneInfo(config.id);

    const behavior = new NpcBehavior(config, this.engine);
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

    const timer = setTimeout(async () => {
      if (!this.running) return;
      try {
        await behavior.tick();
        behavior.cleanupGreetHistory();
      } catch (err) {
        console.error(`🤖 NPC ${config.name} 行为异常:`, err.message);
      }
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
