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

  // 使用物品: status --use <itemKey>
  if (flags.use) {
    const { auth, result } = await runAuthenticated('POST', '/api/stats/use', { itemKey: flags.use });
    if (!result) throwForAuth(auth);
    console.log(result.log || result.error || JSON.stringify(result));
    return;
  }

  // 装备物品: status --equip <itemKey>
  if (flags.equip) {
    const { auth, result } = await runAuthenticated('POST', '/api/stats/equip', { itemKey: flags.equip });
    if (!result) throwForAuth(auth);
    console.log(result.log || result.error || JSON.stringify(result));
    return;
  }

  // 查看状态（默认）
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

  // 背包详情
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

module.exports = { walk, chat, interact, status };
