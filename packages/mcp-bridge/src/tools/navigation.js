const definitions = [
  {
    name: 'map',
    description: '查看小镇地图。返回所有可前往地点的 id、名称和坐标，用于 walk --to 导航。',
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
  return { content: [{ type: 'text', text: client.formatMap(result) }] };
}

module.exports = { definitions, handle };
