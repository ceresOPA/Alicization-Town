const definitions = [
  {
    name: 'interact',
    description: '与当前所在区域互动（吃饭、休息、购物、训练、钓鱼等），会根据你所在的地点产生不同的故事结果。在有资源的区域（面馆、集市、魔药店），可以通过 item 参数指定消耗的物品名称（如"湖南米粉"、"苹果"、"精力药水"），不传则随机消耗。',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: '指定要消耗的物品名称（可选，如"湖南米粉"、"苹果"、"精力药水"），不传则随机消耗一种可用资源' },
      },
    },
    annotations: { title: 'Interact', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, args, client) {
  if (name !== 'interact') return null;
  const { auth, result } = await client.interact(args.item || null);
  if (!result) {
    return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
  }
  const perceptionText = client.formatPerceptions(result.perceptions);

  // 尝试附带 base-stats 属性摘要
  let attrText = '';
  try {
    const { result: statsResult } = await client.getBaseStats();
    if (statsResult) {
      attrText = '\n\n' + client.formatBaseStats(statsResult);
    }
  } catch {}

  // 神社怪谈：如果在神社交互，主动获取怪谈内容
  let shrineText = '';
  if (/shrine|神社/i.test(result.zone || '')) {
    try {
      const stories = await client.getGhostStories();
      if (stories.length > 0) {
        shrineText = '\n\n👻 【神社怪谈板】\n';
        for (const s of stories) {
          shrineText += `• "${s.text}" — ${s.author}\n`;
        }
      }
    } catch {}
  }

  return { content: [{ type: 'text', text: client.formatInteract(result) + shrineText + perceptionText + attrText }] };
}

module.exports = { definitions, handle };
