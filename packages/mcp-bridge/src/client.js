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

async function interact() {
  return authenticatedRequest('POST', '/api/interact');
}

async function recallMemories(options = {}) {
  const { auth, result } = await authenticatedRequest('POST', '/api/memories/recall', options);
  return { auth, result: result ? result.memories || [] : null };
}

async function setThinking(isThinking) {
  await authenticatedRequest('PUT', '/api/status', { isThinking });
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
  recallMemories,
  setThinking,
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
  appendMemorySection: townClient.appendMemorySection,
  buildAutoMemoryContext: townClient.buildAutoMemoryContext,
  formatPerceptions: townClient.formatPerceptions,
};
