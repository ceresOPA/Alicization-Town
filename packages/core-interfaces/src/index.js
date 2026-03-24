/**
 * @alicization/core-interfaces
 *
 * 公开接口层 — 定义 Alicization Town 插件系统的所有契约。
 * 开源核心和闭源插件都依赖此包，但此包不依赖任何引擎内部实现。
 */

const { IPlugin } = require('./IPlugin');
const { IPluginContext } = require('./IPluginContext');
const { IInteractionProvider } = require('./IInteractionProvider');
const { INpcStrategy } = require('./INpcStrategy');
const {
  WorldEventType,
  PerceptionEventType,
  PluginLifecycleEvent,
} = require('./events');

module.exports = {
  // 核心接口
  IPlugin,
  IPluginContext,
  IInteractionProvider,
  INpcStrategy,

  // 事件常量
  WorldEventType,
  PerceptionEventType,
  PluginLifecycleEvent,
};
