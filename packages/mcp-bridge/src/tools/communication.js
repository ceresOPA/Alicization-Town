const definitions = [
  {
    name: 'chat',
    description: '小镇聊天频道。不传 text 时查看最近的对话记录；传 text 时发言并查看最近对话。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要说的话（可选，不传则只查看聊天记录）' },
      },
    },
    annotations: { title: 'Chat', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'look',
    description: '环顾四周，看看当前位置、环境和附近的人',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Look', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, args, client) {
  if (name === 'chat') {
    let selfText = null;
    let perceptionText = '';
    if (args.text) {
      const { result } = await client.sendChat(args.text);
      if (!result) {
        return { content: [{ type: 'text', text: '当前还没有可用 profile，请先 login。' }] };
      }
      selfText = args.text;
      perceptionText = client.formatPerceptions(result.perceptions);
    }
    const chatData = await client.getChat(null, 20);
    return { content: [{ type: 'text', text: client.formatChat(chatData.messages, selfText) + perceptionText }] };
  }

  if (name === 'look') {
    const { auth, result } = await client.look();
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    const perceptionText = client.formatPerceptions(result.perceptions);

    // 如果当前在资源区域，附加资源库存信息
    let resourceText = '';
    if (result.player?.zone) {
      const zoneRes = await client.getZoneResources(result.player.zone);
      if (zoneRes && zoneRes.hasResources && zoneRes.resources) {
        resourceText = '\n\n🏪 【当前区域资源】\n';
        const available = zoneRes.resources.filter(r => r.current > 0);
        const empty = zoneRes.resources.filter(r => r.current <= 0);
        if (available.length > 0) {
          for (const r of available) {
            resourceText += `  • ${r.label}: ${r.current}${r.unit}剩余\n`;
          }
        }
        if (empty.length > 0) {
          resourceText += `  ⚠️ 已售罄: ${empty.map(r => r.label).join('、')}\n`;
        }
        if (available.length === 0) {
          resourceText += '  ⚠️ 所有物品已售罄，需要用户补充！\n';
        }
      }
    }

    return { content: [{ type: 'text', text: client.formatLook(result) + resourceText + perceptionText }] };
  }

  return null;
}

module.exports = { definitions, handle };
