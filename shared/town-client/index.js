const {
  TOKEN_TTL_MS,
  LEASE_TTL_MS,
  HEARTBEAT_INTERVAL_MS,
  LOGIN_PROOF_TTL_MS,
  DEFAULT_SERVER_URL,
  STORAGE_ROOT,
} = require('./config');
const storage = require('./storage');
const { requestJson, discoverServer, injectRegistry } = require('./http-client');
const rawServerRegistry = require('./server-registry');
const {
  SessionHandle,
  login,
  heartbeat,
  ensureOnline,
  runAuthenticated,
  logoutProfile,
} = require('./session-handle');
const {
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
} = require('./formatters');
const {
  AUTO_MEMORY_LIMITS,
  buildAutoMemoryContext,
  appendAutoMemories,
} = require('./memory');

// Wire up cross-module dependencies
rawServerRegistry.inject(storage);
const serverRegistry = {
  ...rawServerRegistry,
  setDefaultServer(url) {
    const result = rawServerRegistry.setDefaultServer(url);
    storage.setServerFingerprint(rawServerRegistry.serverFingerprint(result.url));
    return result;
  },
};
storage.setServerFingerprint(rawServerRegistry.serverFingerprint(process.env.SERVER_URL || rawServerRegistry.getDefaultServer()));
injectRegistry(serverRegistry);

module.exports = {
  SessionHandle,
  TOKEN_TTL_MS,
  LEASE_TTL_MS,
  HEARTBEAT_INTERVAL_MS,
  LOGIN_PROOF_TTL_MS,
  DEFAULT_SERVER_URL,
  STORAGE_ROOT,
  listProfiles: storage.listProfiles,
  loadProfile: storage.loadProfile,
  saveProfile: storage.saveProfile,
  getDefaultProfileName: storage.getDefaultProfileName,
  setDefaultProfileName: storage.setDefaultProfileName,
  setServerFingerprint: storage.setServerFingerprint,
  getServerFingerprint: storage.getServerFingerprint,
  discoverServer,
  serverRegistry,
  login,
  heartbeat,
  ensureOnline,
  runAuthenticated,
  logoutProfile,
  requestJson,
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
  AUTO_MEMORY_LIMITS,
  buildAutoMemoryContext,
  appendAutoMemories,
};
