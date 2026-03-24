/**
 * 事件类型常量与事件载荷类型定义。
 *
 * 所有引擎事件和插件事件都应使用此处定义的常量，
 * 避免魔法字符串。
 */

/** 世界引擎内置事件类型 */
const WorldEventType = Object.freeze({
  /** 世界状态变更（玩家移动、加入、离开等） */
  STATE_CHANGE: 'stateChange',
  /** 聊天消息 */
  CHAT: 'chat',
  /** 区域交互 */
  INTERACTION: 'interaction',
  /** 玩家活动日志更新 */
  ACTIVITY: 'activity',
});

/** 感知事件类型（perception 系统使用） */
const PerceptionEventType = Object.freeze({
  SAY: 'say',
  CHAT: 'chat',
  INTERACT: 'interact',
  JOIN: 'join',
  LEAVE: 'leave',
  MOVE: 'move',
});

/** 插件生命周期事件 */
const PluginLifecycleEvent = Object.freeze({
  /** 插件注册完成 */
  REGISTERED: 'plugin:registered',
  /** 插件即将卸载 */
  UNREGISTERING: 'plugin:unregistering',
  /** 插件卸载完成 */
  UNREGISTERED: 'plugin:unregistered',
});

module.exports = {
  WorldEventType,
  PerceptionEventType,
  PluginLifecycleEvent,
};
