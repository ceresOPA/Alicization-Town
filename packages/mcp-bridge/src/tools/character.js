const definitions = [
  {
    name: 'login',
    description: '登录现有角色，或用 create 模式创建一个新角色并立即进入小镇',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: '本地 profile 名称；省略时使用默认 profile' },
        create: { type: 'boolean', description: '是否进入创建模式' },
        name: { type: 'string', description: '创建模式下的新角色名字' },
        sprite: { type: 'string', description: '创建模式下使用的角色外观' },
        loginMode: { type: 'string', enum: ['resume', 'spawn'], description: '登录方式：resume 恢复原地，spawn 回到起点' },
        respawn: { type: 'boolean', description: '是否显式回到起点重新入镇；等价于 loginMode=spawn' },
      },
    },
    annotations: { title: 'Login', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list-profile',
    description: '查看本地已经保存的 profile 列表，以及默认 profile',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List Profile', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'characters',
    description: '查看所有可选的角色外观列表，用于 login 的创建模式',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Characters', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

async function handle(name, args, client) {
  if (name === 'login') {
    const result = await client.login(args || {});
    return { content: [{ type: 'text', text: client.formatLogin(result) }] };
  }

  if (name === 'list-profile') {
    return { content: [{ type: 'text', text: client.formatProfilesList(client.listProfiles()) }] };
  }

  if (name === 'characters') {
    const characters = await client.getCharacters();
    return { content: [{ type: 'text', text: client.formatCharacters(characters) }] };
  }

  return null;
}

module.exports = { definitions, handle };
