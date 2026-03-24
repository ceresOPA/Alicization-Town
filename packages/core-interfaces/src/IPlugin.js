/**
 * 插件基类 — 所有 Alicization Town 插件必须继承此类。
 *
 * 生命周期：
 *   1. 构造 → 2. onRegister(ctx) → 3. 运行期 → 4. onUnregister()
 *
 * @abstract
 */
class IPlugin {
  /**
   * 插件唯一标识符，格式建议: 'scope/name'（如 '@alicization/rpg-advanced'）。
   * 子类必须覆写此 getter。
   * @returns {string}
   */
  get id() {
    throw new Error('Plugin must override get id()');
  }

  /**
   * 插件版本号（semver），用于兼容性检查。
   * @returns {string}
   */
  get version() {
    return '0.0.0';
  }

  /**
   * 声明此插件兼容的 core-interfaces 版本范围（semver range）。
   * PluginManager 在加载时会校验。
   * @returns {string}
   */
  get compatibleCoreVersion() {
    return '>=1.0.0';
  }

  /**
   * 插件注册时调用。通过 PluginContext 注册交互、NPC策略、路由等扩展。
   * @param {import('./IPluginContext')} ctx
   * @returns {Promise<void>}
   */
  async onRegister(ctx) {
    // 默认空实现，子类按需覆写
  }

  /**
   * 插件卸载时调用。用于清理定时器、连接等资源。
   * @returns {Promise<void>}
   */
  async onUnregister() {
    // 默认空实现
  }
}

module.exports = { IPlugin };
