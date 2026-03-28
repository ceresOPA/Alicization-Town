/**
 * BaseStatsPlugin — 基础属性系统内置插件。
 *
 * 将玩家属性（HP/ATK/DEF）、背包/物品、等级/经验、金币系统
 * 作为主项目的内置功能提供，供所有插件共享访问。
 *
 * 注册内容：
 *   - 事件监听：玩家登录时自动初始化属性
 *   - API 路由：/stats/status, /stats/inventory, /stats/use, /stats/equip
 */

const { IPlugin } = require('@alicization/core-interfaces');

class BaseStatsPlugin extends IPlugin {
  get id() { return 'base/stats'; }
  get version() { return '1.0.0'; }

  async onRegister(ctx) {
    // ── 监听玩家登录，自动初始化属性 ──────────────────────────────────────
    ctx.onEvent('playerLogin', (data) => {
      if (data && data.playerId) {
        ctx.getPlayerStats(data.playerId, data.playerName);
      }
    });

    // ── 注册 API 路由 ────────────────────────────────────────────────────

    // 查看属性状态
    ctx.registerRoute('get', '/stats/status', (req, res) => {
      const playerId = req.session?.playerId || req.query?.playerId;
      if (!playerId) return res.status(400).json({ error: '需要 playerId' });

      const stats = ctx.getPlayerStats(playerId);
      if (!stats) return res.status(404).json({ error: '玩家不存在' });

      res.json({
        playerName: stats.playerName,
        level: stats.level,
        exp: stats.exp,
        expNeeded: stats.level * 20,
        hp: stats.hp,
        maxHp: stats.maxHp,
        atk: stats.atk,
        def: stats.def,
        gold: stats.gold,
        inventoryCount: stats.inventory.length,
        equipment: stats.equipment,
      });
    });

    // 查看背包
    ctx.registerRoute('get', '/stats/inventory', (req, res) => {
      const playerId = req.session?.playerId || req.query?.playerId;
      if (!playerId) return res.status(400).json({ error: '需要 playerId' });

      const stats = ctx.getPlayerStats(playerId);
      if (!stats) return res.status(404).json({ error: '玩家不存在' });

      res.json({
        inventory: stats.inventory,
        equipment: stats.equipment,
        gold: stats.gold,
      });
    });

    // 使用物品
    ctx.registerRoute('post', '/stats/use', (req, res) => {
      const playerId = req.session?.playerId || req.body?.playerId;
      const itemKey = req.body?.itemKey;
      if (!playerId || !itemKey) return res.status(400).json({ error: '需要 playerId 和 itemKey' });

      const result = ctx.useItem(playerId, itemKey);
      res.json(result);
    });

    // 装备物品
    ctx.registerRoute('post', '/stats/equip', (req, res) => {
      const playerId = req.session?.playerId || req.body?.playerId;
      const itemKey = req.body?.itemKey;
      if (!playerId || !itemKey) return res.status(400).json({ error: '需要 playerId 和 itemKey' });

      const result = ctx.equipItem(playerId, itemKey);
      res.json(result);
    });
  }
}

module.exports = BaseStatsPlugin;
