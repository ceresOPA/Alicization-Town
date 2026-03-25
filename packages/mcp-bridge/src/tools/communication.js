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
    const response = { content: [{ type: 'text', text: client.formatLook(result) + perceptionText }] };
    const memoryContext = client.buildAutoMemoryContext('look', result);
    if (memoryContext) response.memoryContext = memoryContext;
    return response;
  }

  return null;
}

module.exports = { definitions, handle };
