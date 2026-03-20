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

  let info = '📜 【旅游指南】以下是小镇中所有重要地点及其中心坐标：\n\n';
  directory.forEach((place) => {
    info += `🔹 [${place.name}] -> 坐标: (${place.x}, ${place.y})\n   说明: ${place.description}\n`;
  });
  info += '\n💡 提示: 使用 walk 工具前往你想去的地方。';
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
    info += `- ${person.name} 距离你 ${person.distance} 步 (位于 ${person.zone})`;
    if (person.relativeDirection) info += `，在你的${person.relativeDirection}`;
    if (person.message) info += `，他正在说: "${person.message}"`;
    info += '\n';
  });
  return info.trimEnd();
}

function formatWalk(direction, steps) {
  return `你试图向 ${direction} 走 ${steps} 步。请用 look 确认是否到达，或是否撞墙。`;
}

function formatSay(text) {
  return `你说: ${text}`;
}

function formatInteract(result) {
  return `🎭 【互动】\n📍 地点: ${result.zone}\n🎬 行动: ${result.action}\n\n📖 ${result.result}`;
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
  formatSay,
  formatInteract,
  parseFlags,
};
