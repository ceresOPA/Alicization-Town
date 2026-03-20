const definitions = [
  {
    name: 'walk',
    description: '在小镇移动 (N北/S南/W西/E东)',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['N', 'S', 'W', 'E'], description: '移动方向' },
        steps: { type: 'number', description: '移动步数 (1-20)' },
      },
      required: ['direction', 'steps'],
    },
    annotations: { title: 'Walk', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, args, client) {
  if (name !== 'walk') return null;
  const { auth, result } = await client.walk(args.direction, args.steps);
  if (!result) {
    return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
  }
  return { content: [{ type: 'text', text: client.formatWalk(args.direction, args.steps, result) }] };
}

module.exports = { definitions, handle };
