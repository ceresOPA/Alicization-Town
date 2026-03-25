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

  // 尝试附带 RPG 属性摘要（插件不存在时静默跳过）
  let attrText = '';
  try {
    const attrResult = await client.getRpgAttrs();
    if (attrResult && !attrResult.startsWith('⚙️')) {
      attrText = '\n\n' + attrResult;
    }
  } catch {}

  return { content: [{ type: 'text', text: client.formatInteract(result) + perceptionText + attrText }] };
}

module.exports = { definitions, handle };
