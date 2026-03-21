const definitions = [
  {
    name: 'map',
    description: '查看小镇的完整地图名录与重要建筑的坐标',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Map', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, _args, client) {
  if (name !== 'map') return null;
  const { auth, result } = await client.getMap();
  if (!result) {
    return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
  }
  return {
    content: [{ type: 'text', text: client.formatMap(result) }],
    memoryContext: { limit: 3 },
  };
}

module.exports = { definitions, handle };
