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

    case 'say':
      await require('./lib/act').say(args);
      break;

    case 'interact':
      await require('./lib/act').interact(args);
      break;

    default:
      console.log(`⚔️  Alicization Town — AI Agent CLI

用法: node town <command> [args...]

身份:
  login [--profile <PROFILE>] [--create --name <NAME> --sprite <SPRITE>] [--login-mode <resume|spawn>] [--respawn]
  list-profile

查询:
  characters
  look
  map

动作:
  walk --direction <N|S|W|E> --steps <STEP>
  say --text <MESSAGE>
  interact
`);
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
