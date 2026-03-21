const townClient = require('../../../shared/town-client');

let activeHandle = new townClient.SessionHandle();
let heartbeatTimer = null;

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
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
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

function listProfiles() {
  return townClient.listProfiles();
}

async function getCharacters() {
  const server = await townClient.discoverServer();
  const result = await townClient.requestJson(server, 'GET', '/api/characters');
  return result.characters || [];
}

async function getMap() {
  const { auth, result, profile } = await activeHandle.request('GET', '/api/map');
  if (profile?.profile) setActiveProfileName(profile.profile);
  if (profile) startHeartbeatLoop();
  return { auth, result: result ? result.directory : null };
}

async function look() {
  const { auth, result, profile } = await activeHandle.request('GET', '/api/look');
  if (profile?.profile) setActiveProfileName(profile.profile);
  if (profile) startHeartbeatLoop();
  return { auth, result };
}

async function walk(direction, steps) {
  const { auth, result, profile } = await activeHandle.request('POST', '/api/walk', { direction, steps });
  if (profile?.profile) setActiveProfileName(profile.profile);
  if (profile) startHeartbeatLoop();
  return { auth, result };
}

async function say(text) {
  const { auth, result, profile } = await activeHandle.request('POST', '/api/say', { text });
  if (profile?.profile) setActiveProfileName(profile.profile);
  if (profile) startHeartbeatLoop();
  return { auth, result };
}

async function interact() {
  const { auth, result, profile } = await activeHandle.request('POST', '/api/interact');
  if (profile?.profile) setActiveProfileName(profile.profile);
  if (profile) startHeartbeatLoop();
  return { auth, result };
}

async function recallMemories(options = {}) {
  const { auth, result, profile } = await activeHandle.request('POST', '/api/memories/recall', options);
  if (profile?.profile) setActiveProfileName(profile.profile);
  if (profile) startHeartbeatLoop();
  return { auth, result: result ? result.memories || [] : null };
}

async function setThinking(isThinking) {
  const { profile } = await activeHandle.request('PUT', '/api/status', { isThinking });
  if (profile?.profile) setActiveProfileName(profile.profile);
  if (profile) startHeartbeatLoop();
}

module.exports = {
  connect,
  disconnect,
  login,
  listProfiles,
  getCharacters,
  getMap,
  look,
  walk,
  say,
  interact,
  recallMemories,
  setThinking,
  formatLogin: townClient.formatLogin,
  formatProfilesList: townClient.formatProfilesList,
  formatCharacters: townClient.formatCharacters,
  formatMap: townClient.formatMap,
  formatLook: townClient.formatLook,
  formatWalk: townClient.formatWalk,
  formatSay: townClient.formatSay,
  formatInteract: townClient.formatInteract,
  appendMemorySection: townClient.appendMemorySection,
};
