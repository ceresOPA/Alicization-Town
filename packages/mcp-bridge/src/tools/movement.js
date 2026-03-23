const definitions = [
  {
    name: 'walk',
    description: '自动寻路到目标位置。先用 map 获取地点 id，再用 to 参数前往。',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '目标地点精确 id（从 map 工具获取，如 "restaurant#20de"）' },
        x: { type: 'number', description: '绝对 X 坐标（与 y 一起使用）' },
        y: { type: 'number', description: '绝对 Y 坐标（与 x 一起使用）' },
        forward: { type: 'number', description: '相对前方步数（负=后退）' },
        right: { type: 'number', description: '相对右方步数（负=左移）' },
      },
    },
    annotations: { title: 'Walk', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, args, client) {
  if (name !== 'walk') return null;
  const { auth, result } = await client.walk(args);
  if (!result) {
    return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
  }
  if (result.error) {
    return { content: [{ type: 'text', text: `❌ ${result.error}` }] };
  }
  const perceptionText = client.formatPerceptions(result.perceptions);
  return { content: [{ type: 'text', text: client.formatWalk(result) + perceptionText }] };
}

module.exports = { definitions, handle };
