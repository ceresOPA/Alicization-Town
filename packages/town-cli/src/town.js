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

    case 'walk':
      await require('./lib/act').walk(args);
      break;

    case 'chat':
      await require('./lib/act').chat(args);
      break;

    case 'interact':
      await require('./lib/act').interact(args);
      break;

    case 'status':
      await require('./lib/act').status(args);
      break;

    case 'dungeon':
    case 'd':
      await require('./lib/act').dungeon(args);
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
  walk --to <id> | --x <X> --y <Y> | --forward <N> --right <N>
  chat --text <MESSAGE>
  interact [--item <物品名>]       与当前区域互动（可指定物品）
  status                           查看角色属性、背包、装备
  status --use <物品key>           使用消耗品
  status --equip <物品key>         装备武器/防具

地牢:
  dungeon look                     查看周围
  dungeon move <n|s|e|w>           移动
  dungeon attack                   攻击
  dungeon defend                   防御
  dungeon flee                     逃跑
  dungeon loot                     开宝箱
  dungeon descend                  下楼
  dungeon status                   状态
  dungeon exit                     退出地牢
`);
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
