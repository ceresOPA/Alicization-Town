const definitions = [
  {
    name: 'say',
    description: '在小镇里说话',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要说的话' },
      },
      required: ['text'],
    },
    annotations: { title: 'Say', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'look',
    description: '环顾四周，看看当前位置、环境和附近的人',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Look', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, args, client) {
  if (name === 'say') {
    const { auth, result } = await client.say(args.text);
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return { content: [{ type: 'text', text: client.formatSay(args.text) }] };
  }

  if (name === 'look') {
    const { auth, result } = await client.look();
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return {
      content: [{ type: 'text', text: client.formatLook(result) }],
      memoryContext: {
        location: result.player?.zone || null,
        partnerId: result.nearby?.[0]?.id || null,
        limit: 4,
      },
    };
  }

  return null;
}

module.exports = { definitions, handle };
