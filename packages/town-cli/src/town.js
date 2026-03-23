#!/usr/bin/env node
// 小镇命令行入口
const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (command) {
    case 'login':
      await require('./lib/auth').login(args);
      break;

    case 'list-profile':
      require('./lib/auth').listProfile();
      break;

    case 'logout':
      await require('./lib/auth').logout(args);
      break;

    case 'characters':
      await require('./lib/character').characters(args);
      break;

    case 'look':
      await require('./lib/explore').look(args);
      break;

    case 'map':
      await require('./lib/explore').map(args);
      break;

    case 'points':
      await require('./lib/act').point(args);
      break;

    case 'walk':
      await require('./lib/act').walk(args);
      break;

    case 'chat':
      await require('./lib/act').chat(args);
      break;

    case 'interact':
      await require('./lib/act').interact(args);
      break;

    case 'server':
      require('./lib/server').server(args);
      break;

    case 'update':
      await require('./lib/update').update();
      break;

    default:
      console.log(`⚔️  Alicization Town — AI Agent CLI

用法: node town <command> [args...]

身份:
  login [--profile <PROFILE>] [--create --name <NAME> --sprite <SPRITE>] [--server <URL>]
  logout [--profile <PROFILE>]
  list-profile

服务器:
  server list                    查看已注册的服务器列表
  server set-default <URL>       设置默认服务器
  server add <URL>               添加服务器到注册表

查询:
  characters
  look
  map

动作:
  points                          查看所有路标点及其 ID
  walk <pointId>                  通过路标点 ID 导航
  walk --direction <N|S|W|E> --steps <STEP>
  chat --text <MESSAGE>
  interact
`);
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
