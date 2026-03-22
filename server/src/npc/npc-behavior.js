// NPC 行为引擎
// 管理单个 NPC 的状态机与自主行为决策

const DIRECTIONS = ['N', 'S', 'E', 'W'];

/**
 * NPC 行为状态机
 * 状态: idle → walking / chatting / interacting → idle
 */
class NpcBehavior {
  constructor(config, worldEngine) {
    this.config = config;
    this.engine = worldEngine;
    this.playerId = config.id;
    this.state = 'idle';
    this.lastGreetedPlayers = new Map(); // playerId → timestamp，避免重复问候
    this.greetCooldownMs = 60_000; // 对同一玩家的问候冷却时间
  }

  /**
   * 执行一次行为决策
   * @returns {{ action: string, detail: string } | null}
   */
  tick() {
    const player = this.engine.getAllPlayers()[this.playerId];
    if (!player) return null;

    // 刷新心跳，确保 NPC 不会被标记为 offline/idle
    this.engine.touchAction(this.playerId);

    // 优先检查：附近有真人玩家时，优先打招呼
    const greetResult = this._tryGreetNearbyPlayer(player);
    if (greetResult) return greetResult;

    // 按权重随机选择行为
    const action = this._pickWeightedAction();
    switch (action) {
      case 'wander':
        return this._doWander();
      case 'chat':
        return this._doChat();
      case 'interact':
        return this._doInteract();
      case 'idle':
      default:
        return { action: 'idle', detail: '静静站着' };
    }
  }

  /**
   * 检测附近非 NPC 玩家并主动打招呼
   */
  _tryGreetNearbyPlayer(npcPlayer) {
    const allPlayers = this.engine.getAllPlayers();
    const now = Date.now();

    for (const [id, other] of Object.entries(allPlayers)) {
      if (id === this.playerId) continue;
      if (other.isNPC) continue; // 不对其他 NPC 打招呼
      if (other.name === 'Observer') continue;

      const distance = Math.abs(other.x - npcPlayer.x) + Math.abs(other.y - npcPlayer.y);
      if (distance > 8) continue; // 只对较近的玩家问候

      const lastGreeted = this.lastGreetedPlayers.get(id);
      if (lastGreeted && now - lastGreeted < this.greetCooldownMs) continue;

      // 打招呼
      this.lastGreetedPlayers.set(id, now);
      const greetings = this.config.greetings;
      const text = greetings[Math.floor(Math.random() * greetings.length)];
      this.engine.chat(this.playerId, text);
      return { action: 'greet', detail: `向 ${other.name} 打招呼: "${text}"` };
    }

    return null;
  }

  /**
   * 按权重随机选择行为
   */
  _pickWeightedAction() {
    const weights = this.config.behaviorWeights;
    const entries = Object.entries(weights);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (const [action, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return action;
    }
    return entries[entries.length - 1][0];
  }

  /**
   * 随机漫步
   */
  _doWander() {
    const direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    const { wanderStepsMin, wanderStepsMax } = this.config;
    const steps = wanderStepsMin + Math.floor(Math.random() * (wanderStepsMax - wanderStepsMin + 1));
    const result = this.engine.move(this.playerId, direction, steps);
    if (!result) return null;
    return {
      action: 'wander',
      detail: `向 ${direction} 走了 ${result.actualSteps} 步${result.blocked ? '（被挡住了）' : ''}`,
    };
  }

  /**
   * 随机聊天（说闲话）
   */
  _doChat() {
    const chats = this.config.idleChats;
    const text = chats[Math.floor(Math.random() * chats.length)];
    this.engine.chat(this.playerId, text);
    return { action: 'chat', detail: `说: "${text}"` };
  }

  /**
   * 在当前区域执行互动
   */
  _doInteract() {
    const result = this.engine.interact(this.playerId);
    if (!result) return null;
    return { action: 'interact', detail: `在${result.zone}: ${result.action}` };
  }

  /**
   * 清理问候记录中过期的条目
   */
  cleanupGreetHistory() {
    const now = Date.now();
    for (const [id, ts] of this.lastGreetedPlayers) {
      if (now - ts > this.greetCooldownMs * 2) {
        this.lastGreetedPlayers.delete(id);
      }
    }
  }
}

module.exports = { NpcBehavior };
