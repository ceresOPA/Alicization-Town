const definitions = [
  {
    name: 'status',
    description: '查看角色属性、背包、装备，或使用/装备物品。不传参数时显示完整状态；传 action 和 item 可操作背包物品。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['use', 'equip'],
          description: '操作类型：use=使用消耗品，equip=装备武器/防具（可选，不传则查看状态）',
        },
        item: {
          type: 'string',
          description: '物品 key（当 action 为 use 或 equip 时必填）',
        },
      },
    },
    annotations: { title: 'Status', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, args, client) {
  if (name !== 'status') return null;

  const { action, item } = args || {};

  // 使用物品
  if (action === 'use') {
    if (!item) return { content: [{ type: 'text', text: '请指定要使用的物品 key。先用 status 查看背包中的物品列表。' }] };
    const { auth, result } = await client.useStatsItem(item);
    if (!result) return { content: [{ type: 'text', text: auth?.message || '请先 login。' }] };
    return { content: [{ type: 'text', text: result.log || result.error || JSON.stringify(result) }] };
  }

  // 装备物品
  if (action === 'equip') {
    if (!item) return { content: [{ type: 'text', text: '请指定要装备的物品 key。先用 status 查看背包中的物品列表。' }] };
    const { auth, result } = await client.equipStatsItem(item);
    if (!result) return { content: [{ type: 'text', text: auth?.message || '请先 login。' }] };
    return { content: [{ type: 'text', text: result.log || result.error || JSON.stringify(result) }] };
  }

  // 查看状态（默认）
  const { auth, result: statsResult } = await client.getBaseStats();
  if (!statsResult) return { content: [{ type: 'text', text: auth?.message || '请先 login。' }] };

  let text = client.formatBaseStats(statsResult);

  // 附加背包详情
  try {
    const { result: invResult } = await client.getInventory();
    if (invResult) {
      text += '\n\n' + client.formatInventory(invResult);
    }
  } catch {}

  // 附加资源区域概览（RPG 插件提供，优雅降级）
  try {
    const allRes = await client.getAllZoneResources();
    if (allRes && Object.keys(allRes).length > 0) {
      text += '\n\n🏪 【小镇资源库存】\n';
      for (const [zoneId, zone] of Object.entries(allRes)) {
        const items = Object.values(zone.resources);
        const available = items.filter(r => r.current > 0);
        const summary = available.length > 0
          ? available.map(r => `${r.label}×${r.current}`).join(' ')
          : '⚠️ 全部售罄';
        text += `📍 ${zone.zoneName}: ${summary}\n`;
      }
    }
  } catch {}

  return { content: [{ type: 'text', text }] };
}

module.exports = { definitions, handle };
