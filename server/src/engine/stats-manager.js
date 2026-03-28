/**
 * StatsManager — 玩家属性/背包/等级/金币的统一管理器。
 *
 * 设计目标：
 *   - 作为主项目的内置系统，供所有插件共享访问
 *   - 通过 PluginContext 暴露安全的读写接口
 *   - 插件不能直接操作 StatsManager，只能通过 ctx 方法
 */

/**
 * 默认玩家属性模板
 */
function createDefaultStats(playerId, playerName) {
  return {
    playerId,
    playerName: playerName || playerId,
    // 基础战斗属性
    maxHp: 50,
    hp: 50,
    atk: 8,
    def: 3,
    // 等级/经验
    level: 1,
    exp: 0,
    // 金币
    gold: 0,
    // 背包
    inventory: [],
    // 装备槽
    equipment: {
      weapon: null,
      armor: null,
      accessory: null,
    },
    // 状态效果
    buffs: [],
    // 创建时间
    createdAt: Date.now(),
  };
}

class StatsManager {
  constructor() {
    /** @type {Map<string, Object>} playerId → stats */
    this._stats = new Map();
    /** @type {Array<Function>} 属性变更监听器 */
    this._listeners = [];
  }

  /**
   * 获取玩家属性，不存在则自动创建默认值。
   * @param {string} playerId
   * @param {string} [playerName]
   * @returns {Object} stats 对象（引用）
   */
  getOrCreate(playerId, playerName) {
    if (!this._stats.has(playerId)) {
      this._stats.set(playerId, createDefaultStats(playerId, playerName));
    }
    return this._stats.get(playerId);
  }

  /**
   * 获取玩家属性（只读副本）。
   * @param {string} playerId
   * @returns {Object|null}
   */
  get(playerId) {
    const stats = this._stats.get(playerId);
    if (!stats) return null;
    return { ...stats, inventory: [...stats.inventory], equipment: { ...stats.equipment } };
  }

  /**
   * 检查玩家是否已有属性数据。
   * @param {string} playerId
   * @returns {boolean}
   */
  has(playerId) {
    return this._stats.has(playerId);
  }

  /**
   * 修改玩家属性（增量方式）。
   * @param {string} playerId
   * @param {Object} delta - { hp: -10, gold: +5, exp: +20, ... }
   * @returns {Object} 修改后的 stats
   */
  modify(playerId, delta) {
    const stats = this.getOrCreate(playerId);
    for (const [key, value] of Object.entries(delta)) {
      if (key === 'inventory' || key === 'equipment' || key === 'buffs') continue; // 这些用专门方法
      if (typeof stats[key] === 'number' && typeof value === 'number') {
        stats[key] += value;
      }
    }
    // 约束 HP 范围
    if (stats.hp > stats.maxHp) stats.hp = stats.maxHp;
    if (stats.hp < 0) stats.hp = 0;
    // 约束 gold 不为负
    if (stats.gold < 0) stats.gold = 0;

    this._notifyChange(playerId, 'modify', delta);
    return stats;
  }

  /**
   * 直接设置属性值（覆盖方式）。
   * @param {string} playerId
   * @param {Object} values - { hp: 50, atk: 12, ... }
   * @returns {Object} 修改后的 stats
   */
  set(playerId, values) {
    const stats = this.getOrCreate(playerId);
    for (const [key, value] of Object.entries(values)) {
      if (key === 'playerId' || key === 'createdAt') continue; // 不可修改
      if (key in stats) {
        stats[key] = value;
      }
    }
    this._notifyChange(playerId, 'set', values);
    return stats;
  }

  /**
   * 添加物品到背包。
   * @param {string} playerId
   * @param {Object} item - { key, name, type, ... }
   * @returns {{ success: boolean, log: string }}
   */
  addItem(playerId, item) {
    if (!item || !item.key || !item.name) {
      return { success: false, log: '无效的物品' };
    }
    const stats = this.getOrCreate(playerId);
    // 可叠加物品检查
    if (item.stackable) {
      const existing = stats.inventory.find(i => i.key === item.key);
      if (existing) {
        existing.count = (existing.count || 1) + (item.count || 1);
        this._notifyChange(playerId, 'addItem', item);
        return { success: true, log: `获得 ${item.name} x${item.count || 1} (共 ${existing.count})` };
      }
    }
    stats.inventory.push({ ...item, count: item.count || 1 });
    this._notifyChange(playerId, 'addItem', item);
    return { success: true, log: `获得 ${item.name}` };
  }

  /**
   * 从背包移除物品。
   * @param {string} playerId
   * @param {string} itemKey
   * @param {number} [count=1]
   * @returns {{ success: boolean, item?: Object, log: string }}
   */
  removeItem(playerId, itemKey, count = 1) {
    const stats = this._stats.get(playerId);
    if (!stats) return { success: false, log: '玩家不存在' };

    const idx = stats.inventory.findIndex(i => i.key === itemKey);
    if (idx === -1) return { success: false, log: '背包中没有该物品' };

    const item = stats.inventory[idx];
    if (item.stackable && (item.count || 1) > count) {
      item.count -= count;
      this._notifyChange(playerId, 'removeItem', { key: itemKey, count });
      return { success: true, item: { ...item }, log: `使用了 ${item.name} x${count}` };
    }

    stats.inventory.splice(idx, 1);
    this._notifyChange(playerId, 'removeItem', { key: itemKey, count });
    return { success: true, item, log: `失去了 ${item.name}` };
  }

  /**
   * 使用消耗品。
   * @param {string} playerId
   * @param {string} itemKey
   * @returns {{ success: boolean, log: string, effect?: string }}
   */
  useItem(playerId, itemKey) {
    const stats = this._stats.get(playerId);
    if (!stats) return { success: false, log: '玩家不存在' };

    const idx = stats.inventory.findIndex(i => i.key === itemKey);
    if (idx === -1) return { success: false, log: '背包中没有该物品' };

    const item = stats.inventory[idx];
    if (item.type !== 'consumable') return { success: false, log: '该物品不可使用' };

    // 移除消耗品
    if (item.stackable && (item.count || 1) > 1) {
      item.count -= 1;
    } else {
      stats.inventory.splice(idx, 1);
    }

    // 应用效果
    if (item.effect === 'heal') {
      const healed = Math.min(item.value || 0, stats.maxHp - stats.hp);
      stats.hp += healed;
      this._notifyChange(playerId, 'useItem', item);
      return { success: true, log: `使用 ${item.name}，恢复 ${healed} HP (HP: ${stats.hp}/${stats.maxHp})` };
    }
    if (item.effect === 'flee') {
      this._notifyChange(playerId, 'useItem', item);
      return { success: true, log: `使用 ${item.name}，可以安全逃离！`, effect: 'flee' };
    }
    if (item.effect === 'atkUp') {
      stats.atk += (item.value || 1);
      this._notifyChange(playerId, 'useItem', item);
      return { success: true, log: `使用 ${item.name}，攻击力 +${item.value}` };
    }
    if (item.effect === 'defUp') {
      stats.def += (item.value || 1);
      this._notifyChange(playerId, 'useItem', item);
      return { success: true, log: `使用 ${item.name}，防御力 +${item.value}` };
    }

    this._notifyChange(playerId, 'useItem', item);
    return { success: true, log: `使用了 ${item.name}` };
  }

  /**
   * 装备物品。
   * @param {string} playerId
   * @param {string} itemKey
   * @returns {{ success: boolean, log: string }}
   */
  equip(playerId, itemKey) {
    const stats = this._stats.get(playerId);
    if (!stats) return { success: false, log: '玩家不存在' };

    const idx = stats.inventory.findIndex(i => i.key === itemKey);
    if (idx === -1) return { success: false, log: '背包中没有该物品' };

    const item = stats.inventory[idx];
    const slot = item.type === 'weapon' ? 'weapon' : item.type === 'armor' ? 'armor' : item.type === 'accessory' ? 'accessory' : null;
    if (!slot) return { success: false, log: '该物品不可装备' };

    // 卸下旧装备
    const old = stats.equipment[slot];
    if (old) {
      stats.inventory.push(old);
      // 移除旧装备属性加成
      if (old.atkBonus) stats.atk -= old.atkBonus;
      if (old.defBonus) stats.def -= old.defBonus;
      if (old.hpBonus) { stats.maxHp -= old.hpBonus; stats.hp = Math.min(stats.hp, stats.maxHp); }
    }

    // 装备新物品
    stats.inventory.splice(idx, 1);
    stats.equipment[slot] = item;

    // 应用新装备属性加成
    if (item.atkBonus) stats.atk += item.atkBonus;
    if (item.defBonus) stats.def += item.defBonus;
    if (item.hpBonus) { stats.maxHp += item.hpBonus; }

    this._notifyChange(playerId, 'equip', { slot, item });
    const log = old
      ? `装备了 ${item.name}（替换 ${old.name}）`
      : `装备了 ${item.name}`;
    return { success: true, log };
  }

  /**
   * 经验值升级检查。
   * @param {string} playerId
   * @returns {string[]} 升级日志
   */
  checkLevelUp(playerId) {
    const stats = this._stats.get(playerId);
    if (!stats) return [];

    const logs = [];
    let expNeeded = stats.level * 20;
    while (stats.exp >= expNeeded) {
      stats.exp -= expNeeded;
      stats.level += 1;
      stats.maxHp += 5;
      stats.hp = Math.min(stats.hp + 10, stats.maxHp);
      stats.atk += 2;
      stats.def += 1;
      logs.push(`升级！等级 ${stats.level} (HP+5, ATK+2, DEF+1)`);
      expNeeded = stats.level * 20;
    }
    if (logs.length > 0) {
      this._notifyChange(playerId, 'levelUp', { level: stats.level });
    }
    return logs;
  }

  /**
   * 添加金币。
   * @param {string} playerId
   * @param {number} amount
   * @returns {{ success: boolean, log: string }}
   */
  addGold(playerId, amount) {
    const stats = this.getOrCreate(playerId);
    stats.gold += amount;
    if (stats.gold < 0) stats.gold = 0;
    this._notifyChange(playerId, 'gold', { amount });
    return { success: true, log: amount >= 0 ? `获得 ${amount} 金币 (共 ${stats.gold})` : `失去 ${-amount} 金币 (共 ${stats.gold})` };
  }

  /**
   * 注册属性变更监听器。
   * @param {Function} listener - (playerId, changeType, data) => void
   * @returns {Function} 取消监听的函数
   */
  onChange(listener) {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  /**
   * 获取所有玩家ID。
   * @returns {string[]}
   */
  getAllPlayerIds() {
    return [...this._stats.keys()];
  }

  /**
   * 删除玩家数据。
   * @param {string} playerId
   */
  remove(playerId) {
    this._stats.delete(playerId);
  }

  /** @private */
  _notifyChange(playerId, changeType, data) {
    for (const listener of this._listeners) {
      try {
        listener(playerId, changeType, data);
      } catch (err) {
        console.error(`[StatsManager] 监听器异常:`, err.message);
      }
    }
  }
}

module.exports = { StatsManager, createDefaultStats };
