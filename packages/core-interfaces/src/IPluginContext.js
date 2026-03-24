/**
 * 插件上下文 — 插件通过此接口与引擎交互。
 *
 * PluginContext 是引擎向插件暴露的唯一入口，
 * 插件不应直接引用 world-engine 或其他内部模块。
 *
 * @abstract
 */
class IPluginContext {
  /**
   * 注册区域交互内容。
   * 同一 zoneCategory 可被多个插件注册，引擎会合并所有交互池。
   *
   * @param {string} zoneCategory - 区域分类 (如 'restaurant', 'inn', 'shrine')
   * @param {Array<InteractionEntry>} interactions - 交互条目数组
   *
   * @typedef {Object} InteractionEntry
   * @property {string} action  - 玩家执行的动作描述
   * @property {string} result  - 动作结果描述
   * @property {string} [icon]  - 显示图标名
   * @property {string} [sound] - 播放音效名
   */
  registerInteractions(zoneCategory, interactions) {
    throw new Error('Not implemented');
  }

  /**
   * 注册区域交互类型。
   * 将 zone 分类映射到交互类型 (building / nature / landmark 等)。
   *
   * @param {string} zoneCategory - 区域分类
   * @param {string} interactionType - 交互类型 (如 'building', 'nature', 'landmark')
   */
  registerInteractionType(zoneCategory, interactionType) {
    throw new Error('Not implemented');
  }

  /**
   * 注册 NPC 行为策略。
   * 策略函数在 NPC tick 时被调用，返回要执行的行为。
   *
   * @param {string} strategyName - 策略名称（唯一）
   * @param {NpcStrategyFn} strategyFn - 策略函数
   *
   * @callback NpcStrategyFn
   * @param {Object} npc - NPC 状态信息
   * @param {Object} npc.player   - NPC 的玩家对象
   * @param {Object} npc.config   - NPC 配置
   * @param {Array}  npc.nearbyPlayers - 附近的真人玩家列表
   * @param {Object} worldState - 只读的世界状态快照
   * @returns {Promise<{ action: string, detail: string }|null>}
   */
  registerNpcStrategy(strategyName, strategyFn) {
    throw new Error('Not implemented');
  }

  /**
   * 注册新的 HTTP API 路由。
   * 路由将被挂载到 /api/plugins/<path>。
   *
   * @param {'get'|'post'|'put'|'delete'} method - HTTP 方法
   * @param {string} path - 路由路径 (如 '/combat/attack')
   * @param {Function} handler - Express 路由处理函数 (req, res)
   * @param {Object} [options]
   * @param {boolean} [options.requireSession=true] - 是否需要登录会话
   */
  registerRoute(method, path, handler, options) {
    throw new Error('Not implemented');
  }

  /**
   * 监听世界事件。
   *
   * @param {string} eventType - 事件类型 ('stateChange'|'chat'|'interaction'|'activity')
   * @param {Function} handler - 事件处理函数
   * @returns {Function} 取消监听的函数
   */
  onEvent(eventType, handler) {
    throw new Error('Not implemented');
  }

  /**
   * 注册 Express 中间件。
   * 中间件按注册顺序执行，在路由处理之前。
   *
   * @param {Function} middleware - Express 中间件函数 (req, res, next)
   */
  registerMiddleware(middleware) {
    throw new Error('Not implemented');
  }

  /**
   * 注册 zone 分类匹配规则。
   * 用于将 Tiled 导出的区域名称映射到分类。
   *
   * @param {RegExp} matcher - 匹配区域名的正则表达式
   * @param {string} category - 映射到的分类名
   */
  registerZoneMatcher(matcher, category) {
    throw new Error('Not implemented');
  }
}

module.exports = { IPluginContext };
