const definitions = [
  {
    name: 'status',
    description: '查看自己的身体状态（饥饿、精力、心情、社交等属性）、行动建议，以及小镇各资源区域的库存情况。需要 RPG 插件支持。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Status', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, _args, client) {
  if (name !== 'status') return null;
  const attrText = await client.getRpgAttrs();

  // 附加全部资源区域的库存概览
  let resourceOverview = '';
  try {
    const allRes = await client.getAllZoneResources();
    if (allRes && Object.keys(allRes).length > 0) {
      resourceOverview = '\n\n🏪 【小镇资源库存】\n';
      for (const [zoneId, zone] of Object.entries(allRes)) {
        const items = Object.values(zone.resources);
        const available = items.filter(r => r.current > 0);
        const summary = available.length > 0
          ? available.map(r => `${r.label}×${r.current}`).join(' ')
          : '⚠️ 全部售罄';
        resourceOverview += `📍 ${zone.zoneName}: ${summary}\n`;
      }
    }
  } catch { /* RPG plugin not loaded */ }

  return { content: [{ type: 'text', text: attrText + resourceOverview }] };
}

module.exports = { definitions, handle };
