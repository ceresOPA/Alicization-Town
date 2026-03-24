/**
 * 交互内容提供者接口。
 *
 * 如果插件需要动态生成交互内容（如基于玩家状态、时间等），
 * 可以实现此接口并通过 PluginContext 注册。
 *
 * @abstract
 */
class IInteractionProvider {
  /**
   * 提供者的唯一标识。
   * @returns {string}
   */
  get id() {
    throw new Error('InteractionProvider must override get id()');
  }

  /**
   * 返回此提供者支持的区域分类列表。
   * @returns {string[]}
   */
  getSupportedCategories() {
    throw new Error('Not implemented');
  }

  /**
   * 获取指定区域分类的交互池。
   * 可以根据运行时状态动态返回不同的交互条目。
   *
   * @param {string} zoneCategory - 区域分类
   * @param {Object} context - 运行时上下文
   * @param {Object} context.player - 执行交互的玩家信息
   * @param {Object} context.zone   - 当前区域信息
   * @param {number} context.time   - 当前时间戳
   * @returns {Array<{ action: string, result: string, icon?: string, sound?: string }>}
   */
  getInteractions(zoneCategory, context) {
    return [];
  }
}

module.exports = { IInteractionProvider };
