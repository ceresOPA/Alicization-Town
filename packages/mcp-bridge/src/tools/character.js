const definitions = [
  {
    name: 'login',
    description: '登录现有角色，或用 create 模式创建一个新角色并立即进入小镇。可通过 server 参数指定目标服务器地址。',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: '本地 profile 名称；省略时使用默认 profile' },
        create: { type: 'boolean', description: '是否进入创建模式' },
        name: { type: 'string', description: '创建模式下的新角色名字' },
        sprite: { type: 'string', description: '创建模式下使用的角色外观' },
        server: { type: 'string', description: '服务器名称或地址 (如 "测试服" 或 "http://example.com:5660")；省略时使用默认服务器' },
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
    name: 'logout',
    description: '登出当前角色，结束本地保存的在线会话',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Logout', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'characters',
    description: '查看所有可选的角色外观列表，用于 login 的创建模式',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Characters', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'check_character',
    description: '查看当前登录角色的属性面板，包括等级、经验、生命值、属性点和金币等',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Check Character', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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

  if (name === 'logout') {
    return { content: [{ type: 'text', text: client.stringifyResult(await client.logout()) }] };
  }

  if (name === 'characters') {
    const characters = await client.getCharacters();
    return { content: [{ type: 'text', text: client.formatCharacters(characters) }] };
  }

  if (name === 'check_character') {
    const character = await client.getCharacter();
    if (!character) {
      return { content: [{ type: 'text', text: '你还没有登录角色，请先使用 login 命令登录。' }] };
    }
    return { content: [{ type: 'text', text: client.formatCharacter(character) }] };
  }

  return null;
}

module.exports = { definitions, handle };
