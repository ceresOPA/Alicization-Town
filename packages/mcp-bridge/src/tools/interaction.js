const definitions = [
  {
    name: 'interact',
    description: '与当前所在区域互动（吃饭、休息、购物、训练、钓鱼等），会根据你所在的地点产生不同的故事结果',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Interact', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, _args, client) {
  if (name !== 'interact') return null;
  const { auth, result } = await client.interact();
  if (!result) {
    return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
  }
  const perceptionText = client.formatPerceptions(result.perceptions);
  return {
    content: [{ type: 'text', text: client.formatInteract(result) + perceptionText }],
    memoryContext: client.buildAutoMemoryContext('interact', result),
  };
}

module.exports = { definitions, handle };
