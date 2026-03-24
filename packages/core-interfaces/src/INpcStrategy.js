/**
 * NPC 行为策略接口。
 *
 * 插件可以实现此接口来替换或扩展 NPC 的决策逻辑。
 * 通过 PluginContext.registerNpcStrategy() 注册后，
 * 可在 NPC 配置中通过 strategy 字段引用。
 *
 * @abstract
 */
class INpcStrategy {
  /**
   * 策略唯一标识。
   * @returns {string}
   */
  get id() {
    throw new Error('NpcStrategy must override get id()');
  }

  /**
   * 执行一次行为决策。
   *
   * @param {Object} context
   * @param {Object} context.npc         - NPC 玩家对象 (id, name, x, y, sprite, ...)
   * @param {Object} context.config      - NPC 配置 (behaviorWeights, greetings, idleChats, ...)
   * @param {Array}  context.nearbyPlayers - 附近的非 NPC 玩家列表
   * @param {Object} context.engine      - 引擎操作接口（受限子集）
   * @param {Function} context.engine.chat     - (playerId, text) => void
   * @param {Function} context.engine.move     - (playerId, target) => Promise
   * @param {Function} context.engine.interact - (playerId) => Object
   * @returns {Promise<{ action: string, detail: string }|null>}
   */
  async tick(context) {
    throw new Error('NpcStrategy must override tick()');
  }

  /**
   * 策略被注销时调用，用于清理内部状态。
   */
  dispose() {
    // 默认空实现
  }
}

module.exports = { INpcStrategy };
