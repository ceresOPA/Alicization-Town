const townClient = require('../../../shared/town-client');

let activeHandle = new townClient.SessionHandle();
let heartbeatTimer = null;
let requestQueue = Promise.resolve();

function runSerial(task) {
  const operation = requestQueue.catch(() => {}).then(task);
  requestQueue = operation.catch(() => {});
  return operation;
}

function setActiveProfileName(profile) {
  if (profile) activeHandle = new townClient.SessionHandle(profile);
}

function startHeartbeatLoop() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async () => {
    await runSerial(async () => {
      const targetProfile = activeHandle.resolveProfileName();
      if (!targetProfile) return;
      try {
        const result = await activeHandle.heartbeat();
        if (!result.ok && result.reason === 'unauthorized') {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      } catch {}
    });
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
  await runSerial(async () => {
    stopHeartbeatLoop();
    const targetProfile = activeHandle.resolveProfileName();
    if (targetProfile) await activeHandle.logout();
    console.error('👋 已离开小镇');
  });
}

async function login(args = {}) {
  return runSerial(async () => {
    const result = await activeHandle.login(args);
    if (result.profile) {
      setActiveProfileName(result.profile);
      if (result.status === 'authenticated' || result.status === 'created_and_authenticated' || result.status === 'took_over_session') {
        startHeartbeatLoop();
      }
    }
    return result;
  });
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
  return runSerial(async () => {
    const { auth, result, profile } = await activeHandle.request('GET', '/api/map');
    if (profile?.profile) setActiveProfileName(profile.profile);
    if (profile) startHeartbeatLoop();
    return { auth, result: result ? result.directory : null };
  });
}

async function look() {
  return runSerial(async () => {
    const { auth, result, profile } = await activeHandle.request('GET', '/api/look');
    if (profile?.profile) setActiveProfileName(profile.profile);
    if (profile) startHeartbeatLoop();
    return { auth, result };
  });
}

async function walk(direction, steps) {
  return runSerial(async () => {
    const { auth, result, profile } = await activeHandle.request('POST', '/api/walk', { direction, steps });
    if (profile?.profile) setActiveProfileName(profile.profile);
    if (profile) startHeartbeatLoop();
    return { auth, result };
  });
}

async function say(text) {
  return runSerial(async () => {
    const { auth, result, profile } = await activeHandle.request('POST', '/api/say', { text });
    if (profile?.profile) setActiveProfileName(profile.profile);
    if (profile) startHeartbeatLoop();
    return { auth, result };
  });
}

async function interact() {
  return runSerial(async () => {
    const { auth, result, profile } = await activeHandle.request('POST', '/api/interact');
    if (profile?.profile) setActiveProfileName(profile.profile);
    if (profile) startHeartbeatLoop();
    return { auth, result };
  });
}

async function setThinking(isThinking) {
  return runSerial(async () => {
    const { profile } = await activeHandle.request('PUT', '/api/status', { isThinking });
    if (profile?.profile) setActiveProfileName(profile.profile);
    if (profile) startHeartbeatLoop();
  });
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
  setThinking,
  formatLogin: townClient.formatLogin,
  formatProfilesList: townClient.formatProfilesList,
  formatCharacters: townClient.formatCharacters,
  formatMap: townClient.formatMap,
  formatLook: townClient.formatLook,
  formatWalk: townClient.formatWalk,
  formatSay: townClient.formatSay,
  formatInteract: townClient.formatInteract,
};
