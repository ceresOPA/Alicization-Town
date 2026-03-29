const { runAuthenticated, formatWalk, formatChatSend, formatInteract, parseFlags } = require('./core');

function throwForAuth(auth) {
  if (!auth) return;
  throw new Error(auth.message || '当前无法执行该操作，请先 login。');
}

async function walk(args) {
  const flags = parseFlags(args);
  const target = {};
  if (flags.to || flags._[0]) target.to = flags.to || flags._.join(' ');
  if (flags.x !== undefined) target.x = Number(flags.x);
  if (flags.y !== undefined) target.y = Number(flags.y);
  if (flags.forward !== undefined) target.forward = Number(flags.forward);
  if (flags.right !== undefined) target.right = Number(flags.right);

  if (!target.to && target.x === undefined && target.forward === undefined && target.right === undefined) {
    throw new Error('用法: town walk --to <地名> | --x <X> --y <Y> | --forward <N> --right <N>');
  }

  const { auth, result } = await runAuthenticated('POST', '/api/walk', target);
  if (!result) throwForAuth(auth);
  if (result.error) throw new Error(result.error);
  console.log(formatWalk(result));
}

async function chat(args) {
  const flags = parseFlags(args);
  const text = flags.text || flags._.join(' ');
  if (!text) {
    throw new Error('用法: town chat --text <消息内容>');
  }

  const { auth, result } = await runAuthenticated('POST', '/api/chat', { text });
  if (!result) throwForAuth(auth);
  console.log(formatChatSend(text));
}

async function interact(args) {
  const flags = parseFlags(args);
  const item = flags.item || flags._.join(' ') || null;
  const body = item ? { item } : undefined;
  const { auth, result } = await runAuthenticated('POST', '/api/interact', body);
  if (!result) throwForAuth(auth);
  console.log(formatInteract(result));
}

async function status(args) {
  const flags = parseFlags(args || []);

  if (flags.use) {
    const { auth, result } = await runAuthenticated('POST', '/api/stats/use', { itemKey: flags.use });
    if (!result) throwForAuth(auth);
    console.log(result.log || result.error || JSON.stringify(result));
    return;
  }

  if (flags.equip) {
    const { auth, result } = await runAuthenticated('POST', '/api/stats/equip', { itemKey: flags.equip });
    if (!result) throwForAuth(auth);
    console.log(result.log || result.error || JSON.stringify(result));
    return;
  }

  const { auth, result } = await runAuthenticated('GET', '/api/stats/status');
  if (!result) throwForAuth(auth);

  const makeBar = (v, m) => {
    const pct = Math.round((v / m) * 10);
    return '█'.repeat(pct) + '░'.repeat(10 - pct);
  };

  let text = '📊 【我的状态】\n';
  text += `🏷️ ${result.playerName || '???'}  Lv.${result.level || 1}\n`;
  text += `❤️ HP: ${result.hp}/${result.maxHp} ${makeBar(result.hp, result.maxHp)}\n`;
  text += `⚔️ ATK: ${result.atk}  🛡️ DEF: ${result.def}\n`;
  text += `✨ EXP: ${result.exp}/${result.expNeeded}\n`;
  text += `💰 Gold: ${result.gold}\n`;
  if (result.equipment) {
    const eq = result.equipment;
    const slots = [];
    if (eq.weapon) slots.push(`武器: ${eq.weapon.name}`);
    if (eq.armor) slots.push(`防具: ${eq.armor.name}`);
    if (eq.accessory) slots.push(`饰品: ${eq.accessory.name}`);
    if (slots.length > 0) text += `🔧 装备: ${slots.join(' | ')}\n`;
  }
  text += `🎒 背包: ${result.inventoryCount} 件物品`;

  try {
    const { result: inv } = await runAuthenticated('GET', '/api/stats/inventory');
    if (inv && inv.inventory && inv.inventory.length > 0) {
      text += '\n\n🎒 【背包】\n';
      for (const item of inv.inventory) {
        const count = item.count > 1 ? ` x${item.count}` : '';
        text += `  ${item.emoji || '•'} [${item.key}] ${item.name}${count}\n`;
      }
    }
  } catch {}

  console.log(text.trimEnd());
}

async function dungeon(args) {
  const flags = parseFlags(args);
  const cmd = flags._[0];

  if (!cmd || cmd === 'look') {
    const { auth, result } = await runAuthenticated('GET', '/api/dungeon/look');
    if (!result) throwForAuth(auth);
    if (result.error) console.log(result.error);
    else console.log(result.view || result.status || JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'move' || cmd === 'm') {
    const dir = flags._[1] || flags.dir;
    if (!dir) throw new Error('用法: town dungeon move <n|s|e|w|ne|nw|se|sw>');
    const { auth, result } = await runAuthenticated('POST', '/api/dungeon/move', { direction: dir });
    if (!result) throwForAuth(auth);
    if (result.error) console.log(result.error);
    else {
      if (result.view) console.log(result.view);
      if (result.msg) console.log(result.msg);
    }
    return;
  }

  if (cmd === 'attack' || cmd === 'a') {
    const { auth, result } = await runAuthenticated('POST', '/api/dungeon/attack');
    if (!result) throwForAuth(auth);
    console.log(result.msg || result.error || JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'defend') {
    const { auth, result } = await runAuthenticated('POST', '/api/dungeon/defend');
    if (!result) throwForAuth(auth);
    console.log(result.msg || result.error || JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'flee') {
    const { auth, result } = await runAuthenticated('POST', '/api/dungeon/flee');
    if (!result) throwForAuth(auth);
    console.log(result.msg || result.error || JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'loot') {
    const { auth, result } = await runAuthenticated('POST', '/api/dungeon/loot');
    if (!result) throwForAuth(auth);
    console.log(result.msg || result.error || JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'descend') {
    const { auth, result } = await runAuthenticated('POST', '/api/dungeon/descend');
    if (!result) throwForAuth(auth);
    console.log(result.msg || result.error || JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'status') {
    const { auth, result } = await runAuthenticated('GET', '/api/dungeon/status');
    if (!result) throwForAuth(auth);
    console.log(result.status || result.error || JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === 'exit') {
    const { auth, result } = await runAuthenticated('POST', '/api/dungeon/exit');
    if (!result) throwForAuth(auth);
    console.log(result.msg || result.error || JSON.stringify(result));
    return;
  }

  console.log(`用法: town dungeon <command>
命令:
  look      查看周围
  move <n|s|e|w|ne|nw|se|sw>  移动
  attack    攻击
  defend    防御
  flee      逃跑
  loot      开宝箱
  descend   下楼
  status    状态
  exit      退出地牢`);
}

module.exports = { walk, chat, interact, status, dungeon };
