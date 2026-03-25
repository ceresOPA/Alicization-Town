function shortId(id) {
  if (!id) return '';
  const s = String(id);
  return ` #${s.slice(-4)}`;
}

function stringifyResult(value) {
  return JSON.stringify(value, null, 2);
}

function formatProfilesList(payload) {
  return stringifyResult(payload);
}

function formatLogin(payload) {
  const { token, ...visible } = payload;
  return stringifyResult(visible);
}

function formatCharacters(characters) {
  if (!characters || characters.length === 0) {
    return '暂时没有收到角色列表，请稍后再试。';
  }

  let info = '🎭 【可选角色】\n';
  characters.forEach((item, index) => {
    info += `${index + 1}. ${item}\n`;
  });
  info += '\n💡 使用 login 的创建模式选择角色并加入小镇。';
  return info;
}

function formatMap(directory) {
  if (!directory || directory.length === 0) {
    return '小镇目前没有任何标记的特殊区域。';
  }

  let info = '📜 【旅游指南】以下是小镇中可前往的地点：\n\n';
  directory.forEach((place) => {
    info += `🔹 [${place.id}] ${place.name} -> 坐标: (${place.x}, ${place.y})\n   说明: ${place.description}\n`;
  });
  const exampleId = directory[0]?.id || 'restaurant#20de';
  info += `\n💡 使用 walk --to "${exampleId}" 前往目标地点（必须使用上方列出的精确 id）。`;
  return info;
}

function formatLook(result) {
  const { player, nearby = [] } = result;
  let info = `📍 【位置感知】\n你当前坐标: (${player.x}, ${player.y})\n`;
  if (player.zone === '小镇街道') {
    info += '你目前身处: 【小镇街道】\n环境描述: 空旷的街道\n\n';
  } else {
    info += `你目前位于或临近: 【${player.zone}】\n环境描述: ${player.zoneDesc}\n\n`;
  }

  if (nearby.length === 0) {
    info += '四周空无一人。';
    return info;
  }

  info += '👥 【附近的人】\n';
  nearby.forEach((person) => {
    info += `- ${person.name}${shortId(person.id)} 距离你 ${person.distance} 步 (位于 ${person.zone})`;
    if (person.relativeDirection) info += `，在你的${person.relativeDirection}`;
    if (person.message) info += `，他正在说: "${person.message}"`;
    else if (person.lastSpeakAt) info += `，最近说过话`;
    info += '\n';
  });
  return info.trimEnd();
}

function formatWalk(result) {
  const { player, pathLength, wasBlocked, targetZone } = result;
  let info = '';
  if (wasBlocked) {
    info += `⚠️ 目标确切位置被阻挡，已到达最近的可通行位置。\n`;
  }
  info += `📍 已到达 (${player.x}, ${player.y})`;
  if (targetZone) info += ` — ${targetZone}`;
  if (player.zone) info += `\n📌 当前区域: ${player.zone}`;
  info += `\n🚶 路径长度: ${pathLength} 步`;
  return info;
}

function formatChatSend(text) {
  return `你说: ${text}`;
}

function formatInteract(result) {
  return `🎭 【互动】\n📍 地点: ${result.zone}\n🎬 行动: ${result.action}\n\n📖 ${result.result}`;
}

function formatMemorySection(memories, { title = 'Relevant memories' } = {}) {
  if (!memories || memories.length === 0) return '';
  const lines = memories.map((memory) => `- ${memory.content}`);
  return `${title}:\n${lines.join('\n')}`;
}

function appendMemorySection(text, memories, options = {}) {
  const section = formatMemorySection(memories, options);
  if (!section) return text;
  return `${text}\n\n${section}`;
}

function formatChat(messages, selfText) {
  let info = '';
  if (selfText) info += `你说: ${selfText}\n\n`;
  if (!messages || messages.length === 0) {
    info += '💬 小镇还很安静，没有人说话。';
    return info;
  }
  info += '💬 【小镇聊天频道】\n';
  for (const msg of messages) {
    const t = new Date(msg.time);
    const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    info += `[${ts}] ${msg.name}${shortId(msg.playerId)}: ${msg.message}\n`;
  }
  return info.trimEnd();
}

function formatPerceptions(perceptions) {
  if (!perceptions || perceptions.length === 0) return '';

  const typeLabels = {
    chat: '💬',
    interact: '🎭',
    move: '🚶',
    join: '👋',
    leave: '👋',
  };

  let info = '\n\n📡 【环境感知】 你注意到了以下事件：\n';
  for (const event of perceptions) {
    const icon = typeLabels[event.type] || '•';
    const attentionBar = event.attention >= 0.7 ? '⚡' : event.attention >= 0.4 ? '●' : '○';
    const tag = shortId(event.fromId);
    if (event.type === 'chat') {
      info += `${attentionBar} ${icon} ${event.from}${tag} 说: "${event.text}" (距离 ${event.distance} 步)\n`;
    } else if (event.type === 'interact') {
      info += `${attentionBar} ${icon} ${event.from}${tag} 在${event.zone}进行了: ${event.action} (距离 ${event.distance} 步)\n`;
    } else if (event.type === 'move') {
      info += `${attentionBar} ${icon} ${event.from}${tag} 移动到了${event.zone} (距离 ${event.distance} 步)\n`;
    } else if (event.type === 'join') {
      info += `${attentionBar} ${icon} ${event.from}${tag} 加入了小镇\n`;
    } else if (event.type === 'leave') {
      info += `${attentionBar} ${icon} ${event.from}${tag} 离开了小镇\n`;
    }
  }
  return info.trimEnd();
}

function parseFlags(args) {
  const result = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      result._.push(current);
      continue;
    }

    const key = current.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

module.exports = {
  stringifyResult,
  formatProfilesList,
  formatLogin,
  formatCharacters,
  formatMap,
  formatLook,
  formatWalk,
  formatChatSend,
  formatChat,
  formatInteract,
  formatMemorySection,
  appendMemorySection,
  formatPerceptions,
  parseFlags,
};
