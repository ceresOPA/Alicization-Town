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
 * 查询 RPG 属性（需要 RPG 插件支持，优雅降级）
 * @returns {string} 格式化后的属性文本
 */
async function getRpgAttrs() {
  try {
    const { auth, result } = await authenticatedRequest('GET', '/api/rpg/attrs');
    if (!result) {
      return auth?.message || '当前还没有可用 profile，请先 login。';
    }
    return formatRpgAttrs(result);
  } catch (err) {
    // 插件未安装时请求会 404
    if (err.statusCode === 404 || err.message?.includes('404')) {
      return '⚙️ 属性系统需要 RPG Advanced 插件支持。当前服务器未安装该插件，请联系服务器管理员了解详情。';
    }
    return '⚙️ 属性系统暂时不可用，请稍后再试。';
  }
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
 * 格式化 RPG 属性数据为可读文本
 */
function formatRpgAttrs(data) {
  if (!data || !data.attrs) {
    return '⚙️ 属性系统需要 RPG Advanced 插件支持。当前服务器未安装该插件，请联系服务器管理员了解详情。';
  }

  let text = '📊 【我的状态】\n';
  const attrLabels = {
    hp: '❤️ 生命',
    hunger: '🍜 饱腹',
    mood: '😊 心情',
    energy: '⚡ 精力',
    social: '💬 社交',
    age: '📅 年龄',
  };

  for (const [key, info] of Object.entries(data.attrs)) {
    const label = attrLabels[key] || key;
    const bar = makeBar(info.value, info.max || 100);
    text += `${label}: ${info.value}/${info.max || 100} ${bar} (${info.label})\n`;
  }

  if (data.suggestions && data.suggestions.length > 0) {
    text += '\n💡 【行动建议】\n';
    for (const s of data.suggestions) {
      text += `• ${s}\n`;
    }
  }

  return text.trimEnd();
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
  getRpgAttrs,
  getZoneResources,
  getAllZoneResources,
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
};
