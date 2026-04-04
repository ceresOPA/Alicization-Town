const townClient = require('../../../shared/town-client');

let activeHandle = new townClient.SessionHandle();
let heartbeatTimer = null;
let pendingNewMessages = [];

function setActiveProfileName(profile) {
  if (profile) activeHandle = new townClient.SessionHandle(profile);
}

function startHeartbeatLoop() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async () => {
    const targetProfile = activeHandle.resolveProfileName();
    if (!targetProfile) return;
    try {
      const result = await activeHandle.heartbeat();
      if (!result.ok && result.reason === 'unauthorized') {
        try {
          const loginResult = await activeHandle.login({ profile: targetProfile });
          if (!loginResult.token) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
            console.error('🔴 MCP Bridge: 自动重登失败，heartbeat 已停止。');
          }
        } catch {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }
    } catch {}
  }, townClient.HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeatLoop() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function connect() {
  const botName = process.env.BOT_NAME;
  const botSprite = process.env.BOT_SPRITE;
  const serverUrl = process.env.SERVER_URL;
  if (botName && botSprite && serverUrl) {
    try {
      await activeHandle.login({ create: true, name: botName, sprite: botSprite, server: serverUrl });
      console.error(`📡 MCP Bridge 已就绪，角色 ${botName} 已自动登录。`);
      startHeartbeatLoop();
      return;
    } catch (err) {
      console.error(`⚠️ 自动登录失败 (${err.message})，等待手动 login。`);
    }
  }
  console.error('📡 MCP Bridge 已准备就绪。');
}

async function disconnect() {
  stopHeartbeatLoop();
  const targetProfile = activeHandle.resolveProfileName();
  if (targetProfile) await activeHandle.logout();
  console.error('👋 已离开小镇');
}

async function login(args = {}) {
  const result = await activeHandle.login(args);
  if (result.profile) {
    setActiveProfileName(result.profile);
    if (result.status === 'authenticated' || result.status === 'created_and_authenticated' || result.status === 'took_over_session') {
      startHeartbeatLoop();
    }
  }
  return result;
}

async function logout(profileName = null) {
  const activeProfile = activeHandle.resolveProfileName();
  const targetProfile = profileName || activeProfile;
  if (!targetProfile) return { ok: false };
  const result = targetProfile === activeProfile
    ? await activeHandle.logout()
    : await townClient.logoutProfile(targetProfile);
  if (targetProfile === activeProfile) {
    stopHeartbeatLoop();
  }
  return result;
}

function listProfiles() {
  return townClient.listProfiles();
}

async function getCharacters() {
  const server = await townClient.discoverServer();
  const result = await townClient.requestJson(server, 'GET', '/api/characters');
  return result.characters || [];
}

async function authenticatedRequest(method, apiPath, body) {
  const { auth, result, profile } = await activeHandle.request(method, apiPath, body);
  if (profile?.profile) setActiveProfileName(profile.profile);
  if (profile) startHeartbeatLoop();
  if (result?.newMessages?.length) pendingNewMessages.push(...result.newMessages);
  return { auth, result };
}

async function getMap() {
  const { auth, result } = await authenticatedRequest('GET', '/api/map');
  return { auth, result: result ? result.directory : null };
}

async function look() {
  return authenticatedRequest('GET', '/api/look');
}

async function walk(target) {
  return authenticatedRequest('POST', '/api/walk', target);
}

async function sendChat(text) {
  return authenticatedRequest('POST', '/api/chat', { text });
}

async function interact(item) {
  const body = item ? { item } : undefined;
  return authenticatedRequest('POST', '/api/interact', body);
}

async function setThinking(isThinking) {
  await authenticatedRequest('PUT', '/api/status', { isThinking });
}

/**
 * 查询基础属性（base-stats 内置插件）
 * @returns {{ auth?: Object, result?: Object }} 原始 API 响应
 */
async function getBaseStats() {
  return authenticatedRequest('GET', '/api/stats/status');
}

/**
 * 查询背包（base-stats 内置插件）
 * @returns {{ auth?: Object, result?: Object }}
 */
async function getInventory() {
  return authenticatedRequest('GET', '/api/stats/inventory');
}

/**
 * 使用消耗品（base-stats 内置插件）
 * @param {string} itemKey
 * @returns {{ auth?: Object, result?: Object }}
 */
async function useStatsItem(itemKey) {
  return authenticatedRequest('POST', '/api/stats/use', { itemKey });
}

/**
 * 装备物品（base-stats 内置插件）
 * @param {string} itemKey
 * @returns {{ auth?: Object, result?: Object }}
 */
async function equipStatsItem(itemKey) {
  return authenticatedRequest('POST', '/api/stats/equip', { itemKey });
}

/**
 * 格式化 base-stats 属性为可读文本
 */
function formatBaseStats(data) {
  if (!data) return '';
  let text = '📊 【我的状态】\n';
  text += `🏷️ ${data.playerName || '???'}  Lv.${data.level || 1}\n`;
  text += `❤️ HP: ${data.hp}/${data.maxHp} ${makeBar(data.hp, data.maxHp)}\n`;
  text += `⚔️ ATK: ${data.atk}  🛡️ DEF: ${data.def}\n`;
  text += `✨ EXP: ${data.exp}/${data.expNeeded}\n`;
  text += `💰 Gold: ${data.gold}\n`;
  if (data.equipment) {
    const eq = data.equipment;
    const slots = [];
    if (eq.weapon) slots.push(`武器: ${eq.weapon.name}`);
    if (eq.armor) slots.push(`防具: ${eq.armor.name}`);
    if (eq.accessory) slots.push(`饰品: ${eq.accessory.name}`);
    if (slots.length > 0) text += `🔧 装备: ${slots.join(' | ')}\n`;
  }
  text += `🎒 背包: ${data.inventoryCount} 件物品`;
  return text;
}

/**
 * 格式化背包内容为可读文本
 */
function formatInventory(data) {
  if (!data) return '';
  let text = `💰 Gold: ${data.gold}\n\n`;
  if (data.equipment) {
    const eq = data.equipment;
    text += '🔧 【装备栏】\n';
    text += `  武器: ${eq.weapon ? eq.weapon.name : '（空）'}\n`;
    text += `  防具: ${eq.armor ? eq.armor.name : '（空）'}\n`;
    text += `  饰品: ${eq.accessory ? eq.accessory.name : '（空）'}\n`;
  }
  text += '\n🎒 【背包】\n';
  if (!data.inventory || data.inventory.length === 0) {
    text += '  （空空如也）';
  } else {
    for (const item of data.inventory) {
      const count = item.count > 1 ? ` x${item.count}` : '';
      const bonus = [];
      if (item.atkBonus) bonus.push(`ATK+${item.atkBonus}`);
      if (item.defBonus) bonus.push(`DEF+${item.defBonus}`);
      if (item.atk) bonus.push(`ATK+${item.atk}`);
      if (item.def) bonus.push(`DEF+${item.def}`);
      if (item.effect === 'heal') bonus.push(`回复${item.value}HP`);
      const bonusText = bonus.length > 0 ? ` (${bonus.join(', ')})` : '';
      text += `  ${item.emoji || '•'} [${item.key}] ${item.name}${count}${bonusText}\n`;
    }
  }
  return text.trimEnd();
}

/**
 * 查询指定区域的资源库存（RPG 插件，优雅降级）
 * @param {string} zoneName - 区域名称
 * @returns {object|null} { hasResources, available, resources, zoneName, zoneId, category } or null
 */
async function getZoneResources(zoneName) {
  try {
    const { result } = await authenticatedRequest('GET', `/api/rpg/zone-check?zone=${encodeURIComponent(zoneName)}`);
    return result || null;
  } catch {
    return null;
  }
}

/**
 * 查询所有区域的资源库存（RPG 插件，优雅降级）
 * @returns {object|null} { [zoneId]: { zoneName, resources: { [type]: { label, current, max, unit } } } }
 */
async function getAllZoneResources() {
  try {
    const { result } = await authenticatedRequest('GET', '/api/rpg/zones/resources');
    return result || null;
  } catch {
    return null;
  }
}

/**
 * 查询神社怪谈（优雅降级）
 * @returns {Array} ghost stories array
 */
async function getGhostStories() {
  try {
    const { result } = await authenticatedRequest('GET', '/api/rpg/shrine/stories');
    return (result && result.stories) || [];
  } catch {
    return [];
  }
}


function makeBar(value, max) {
  const pct = Math.round((value / max) * 10);
  return '█'.repeat(pct) + '░'.repeat(10 - pct);
}


async function getChat(since, limit) {
  const params = new URLSearchParams();
  if (since) params.set('since', String(since));
  if (limit) params.set('limit', String(limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { result } = await activeHandle.request('GET', `/api/chat${qs}`);
  return result || { messages: [], cursor: 0 };
}

async function murderCreateGame({ gameId, humanCharacterId } = {}) {
  const body = {};
  if (gameId) body.gameId = gameId;
  if (humanCharacterId) body.humanCharacterId = humanCharacterId;
  return authenticatedRequest('POST', '/api/plugins/murder/games', body);
}

async function murderStep(gameId) {
  return authenticatedRequest('POST', `/api/plugins/murder/games/${encodeURIComponent(gameId)}/step`);
}

async function murderGetState(gameId) {
  return authenticatedRequest('GET', `/api/plugins/murder/games/${encodeURIComponent(gameId)}`);
}

async function murderSubmitInput(gameId, input) {
  return authenticatedRequest('POST', `/api/plugins/murder/games/${encodeURIComponent(gameId)}/input`, { input });
}

async function murderUseSkill(gameId, { characterId, target, description }) {
  const body = { characterId };
  if (target) body.target = target;
  if (description) body.description = description;
  return authenticatedRequest('POST', `/api/plugins/murder/games/${encodeURIComponent(gameId)}/skill`, body);
}

async function murderAttemptKill(gameId, { killerId, targetId }) {
  return authenticatedRequest('POST', `/api/plugins/murder/games/${encodeURIComponent(gameId)}/kill`, { killerId, targetId });
}

async function murderSearchLocation(gameId, { characterId, location }) {
  return authenticatedRequest('POST', `/api/plugins/murder/games/${encodeURIComponent(gameId)}/search`, { characterId, location });
}

async function murderAutoRun(gameId) {
  return authenticatedRequest('POST', `/api/plugins/murder/games/${encodeURIComponent(gameId)}/autorun`, {});
}

function flushContext() {
  const messages = pendingNewMessages.splice(0, pendingNewMessages.length);
  const seen = new Set();
  return messages.filter((m) => {
    const key = `${m.time}:${m.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  connect,
  disconnect,
  login,
  logout,
  listProfiles,
  getCharacters,
  getMap,
  look,
  walk,
  sendChat,
  interact,
  getChat,
  flushContext,
  setThinking,
  getBaseStats,
  getInventory,
  useStatsItem,
  equipStatsItem,
  formatBaseStats,
  formatInventory,
  getZoneResources,
  getAllZoneResources,
  getGhostStories,
  stringifyResult: townClient.stringifyResult,
  formatLogin: townClient.formatLogin,
  formatProfilesList: townClient.formatProfilesList,
  formatCharacters: townClient.formatCharacters,
  formatMap: townClient.formatMap,
  formatLook: townClient.formatLook,
  formatWalk: townClient.formatWalk,
  formatChatSend: townClient.formatChatSend,
  formatChat: townClient.formatChat,
  formatInteract: townClient.formatInteract,
  formatPerceptions: townClient.formatPerceptions,
  murderCreateGame,
  murderStep,
  murderGetState,
  murderSubmitInput,
  murderUseSkill,
  murderAttemptKill,
  murderSearchLocation,
  murderAutoRun,
};
