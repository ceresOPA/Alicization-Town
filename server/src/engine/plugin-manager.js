/**
 * PluginManager — 插件生命周期管理与 hook 聚合。
 *
 * 职责：
 *   1. 加载/卸载插件
 *   2. 维护所有插件注册的 hooks（交互、NPC策略、路由等）
 *   3. 提供查询接口供引擎在运行时消费 hooks
 *
 * 设计原则：
 *   - 零插件时所有查询返回空，引擎 fallback 到 legacy 逻辑
 *   - 多插件注册同一 zoneCategory 时，合并交互池
 *   - 插件加载顺序 = 注册顺序，后加载的优先级更高
 */

const { PluginContext } = require('./plugin-context');
const { StatsManager } = require('./stats-manager');

class PluginManager {
  constructor() {
    /** @type {Map<string, { plugin: IPlugin, ctx: PluginContext }>} */
    this._plugins = new Map();

    /** 共享玩家属性管理器 */
    this._statsManager = new StatsManager();

    /** 共享 hooks 注册表 — 所有 PluginContext 写入此处 */
    this._hooks = {
      /** zone 分类 → [{ pluginId, items: InteractionEntry[] }] */
      interactions: new Map(),
      /** zone 分类 → { pluginId, type } */
      interactionTypes: new Map(),
      /** zone 分类 → { pluginId, hookFn } — 交互钩子，优先于随机池 */
      interactionHooks: new Map(),
      /** 策略名 → { pluginId, fn } */
      npcStrategies: new Map(),
      /** [{ pluginId, method, path, handler, requireSession }] */
      routes: [],
      /** 事件类型 → [{ pluginId, handler }] */
      eventHandlers: new Map(),
      /** [{ pluginId, fn }] */
      middleware: [],
      /** [{ pluginId, matcher: RegExp, category: string }] */
      zoneMatchers: [],
    };
  }

  /**
   * 加载并注册一个插件。
   * @param {import('@alicization/core-interfaces').IPlugin} plugin
   */
  async loadPlugin(plugin) {
    if (!plugin || !plugin.id) {
      throw new Error('Plugin must have a valid id');
    }
    if (this._plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already loaded`);
    }

    const ctx = new PluginContext(plugin.id, this._hooks, this._statsManager);
    await plugin.onRegister(ctx);
    this._plugins.set(plugin.id, { plugin, ctx });

    console.log(`🔌 插件已加载: ${plugin.id}${plugin.version !== '0.0.0' ? ` v${plugin.version}` : ''}`);
  }

  /**
   * 卸载一个插件，清理其所有注册。
   * @param {string} pluginId
   */
  async unloadPlugin(pluginId) {
    const entry = this._plugins.get(pluginId);
    if (!entry) return;

    // 清理事件监听
    entry.ctx._cleanupEvents();

    // 清理 interactions
    for (const [category, providers] of this._hooks.interactions) {
      this._hooks.interactions.set(
        category,
        providers.filter((p) => p.pluginId !== pluginId),
      );
      if (this._hooks.interactions.get(category).length === 0) {
        this._hooks.interactions.delete(category);
      }
    }

    // 清理 interactionTypes
    for (const [cat, entry_] of this._hooks.interactionTypes) {
      if (entry_.pluginId === pluginId) this._hooks.interactionTypes.delete(cat);
    }

    // 清理 interactionHooks
    for (const [cat, entry_] of this._hooks.interactionHooks) {
      if (entry_.pluginId === pluginId) this._hooks.interactionHooks.delete(cat);
    }

    // 清理 npcStrategies
    for (const [name, entry_] of this._hooks.npcStrategies) {
      if (entry_.pluginId === pluginId) this._hooks.npcStrategies.delete(name);
    }

    // 清理 routes
    this._hooks.routes = this._hooks.routes.filter((r) => r.pluginId !== pluginId);

    // 清理 middleware
    this._hooks.middleware = this._hooks.middleware.filter((m) => m.pluginId !== pluginId);

    // 清理 zoneMatchers
    this._hooks.zoneMatchers = this._hooks.zoneMatchers.filter((m) => m.pluginId !== pluginId);

    await entry.plugin.onUnregister();
    this._plugins.delete(pluginId);

    console.log(`🔌 插件已卸载: ${pluginId}`);
  }

  // ── 查询接口 (供引擎消费) ──────────────────────────────────────────────

  /**
   * 获取指定区域分类的所有插件交互条目（合并池）。
   * @param {string} zoneCategory
   * @returns {Array<{ action: string, result: string, icon?: string, sound?: string }>}
   */
  getInteractions(zoneCategory) {
    const providers = this._hooks.interactions.get(zoneCategory);
    if (!providers || providers.length === 0) return [];
    // 合并所有插件的交互池
    const merged = [];
    for (const provider of providers) {
      merged.push(...provider.items);
    }
    return merged;
  }

  /**
   * 获取指定区域分类的交互钩子。
   * 钩子可拦截交互请求，返回与实际资源消耗精确匹配的结果。
   * @param {string} zoneCategory
   * @returns {Function|null} hookFn(context) => { action, result, icon?, sound?, item? } | null
   */
  getInteractionHook(zoneCategory) {
    const entry = this._hooks.interactionHooks.get(zoneCategory);
    return entry ? entry.hookFn : null;
  }

  /**
   * 获取插件注册的区域分类→交互类型映射。
   * @param {string} zoneCategory
   * @returns {string|null} 交互类型 (building/nature/landmark) 或 null
   */
  getInteractionType(zoneCategory) {
    const entry = this._hooks.interactionTypes.get(zoneCategory);
    return entry ? entry.type : null;
  }

  /**
   * 获取指定名称的 NPC 策略函数。
   * @param {string} strategyName
   * @returns {Function|null}
   */
  getNpcStrategy(strategyName) {
    const entry = this._hooks.npcStrategies.get(strategyName);
    return entry ? entry.fn : null;
  }

  /**
   * 获取所有插件注册的路由。
   * @returns {Array<{ method, path, handler, requireSession }>}
   */
  getRoutes() {
    return this._hooks.routes;
  }

  /**
   * 获取所有插件注册的中间件。
   * @returns {Array<Function>}
   */
  getMiddleware() {
    return this._hooks.middleware.map((m) => m.fn);
  }

  /**
   * 获取所有插件注册的 zone 匹配器（追加到内置匹配器之后）。
   * @returns {Array<[RegExp, string]>}
   */
  getZoneMatchers() {
    return this._hooks.zoneMatchers.map((m) => [m.matcher, m.category]);
  }

  /**
   * 向所有监听指定事件的插件分发事件。
   * @param {string} eventType
   * @param {*} data
   */
  emitPluginEvent(eventType, data) {
    const handlers = this._hooks.eventHandlers.get(eventType);
    if (!handlers) return;
    for (const { handler } of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`🔌 插件事件处理异常 (${eventType}):`, err.message);
      }
    }
  }

  /**
   * 获取共享玩家属性管理器。
   * @returns {StatsManager}
   */
  getStatsManager() {
    return this._statsManager;
  }

  /**
   * 是否有任何插件被加载。
   * @returns {boolean}
   */
  hasPlugins() {
    return this._plugins.size > 0;
  }

  /**
   * 设置活动推送回调。插件调用 ctx.emitActivity() 时会触发此回调。
   * @param {Function} emitter - 接收活动数据的函数
   */
  setActivityEmitter(emitter) {
    this._hooks.activityEmitter = emitter;
  }

  /**
   * 获取已加载插件列表。
   * @returns {Array<{ id: string, version: string }>}
   */
  listPlugins() {
    const list = [];
    for (const [id, { plugin }] of this._plugins) {
      list.push({ id, version: plugin.version });
    }
    return list;
  }
}

module.exports = { PluginManager };
