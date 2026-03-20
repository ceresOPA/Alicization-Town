const crypto = require('crypto');
const { TOKEN_TTL_MS } = require('./config');
const {
  saveProfile,
  loadKeystore,
  saveKeystore,
  setDefaultProfileName,
  listProfileNames,
} = require('./storage');
const { discoverServer, requestJson } = require('./http-client');

function base64Url(buffer) {
  return buffer.toString('base64url');
}

function buildLoginMessage(handle, timestamp) {
  return Buffer.from(`alicization-town:login:${handle}:${timestamp}`, 'utf8');
}

function generateKeyMaterial() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  return {
    deviceId: crypto.randomUUID(),
    publicKey: publicJwk.x,
    jwk: privateJwk,
  };
}

function signLoginProof(handle, timestamp, jwk) {
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  return base64Url(crypto.sign(null, buildLoginMessage(handle, timestamp), key));
}

function normalizeProfileName(input) {
  return String(input || '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveProfileName({ profile, name, handle }) {
  const base = normalizeProfileName(profile || name || handle || 'profile') || 'profile';
  const existing = new Set(listProfileNames());
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

async function createRemoteProfile(server, name, sprite, publicKey) {
  return requestJson(server, 'POST', '/api/profiles/create', {
    body: { name, sprite, publicKey },
  });
}

async function createProfile({ profile: preferredProfileName, name, sprite, server }) {
  const targetServer = await discoverServer(server);
  const keyMaterial = generateKeyMaterial();
  const created = await createRemoteProfile(targetServer, name, sprite, keyMaterial.publicKey);
  const now = new Date().toISOString();
  const profileName = deriveProfileName({ profile: preferredProfileName, name: created.name || name, handle: created.handle });
  const localProfile = {
    profile: profileName,
    handle: created.handle,
    name: created.name || name,
    sprite: created.sprite || sprite,
    server: targetServer,
    token: null,
    expiresAt: null,
    leaseExpiresAt: null,
    lastUsedAt: now,
  };

  saveProfile(localProfile);
  saveKeystore(localProfile.handle, {
    handle: localProfile.handle,
    publicKey: keyMaterial.publicKey,
    deviceId: keyMaterial.deviceId,
    jwk: keyMaterial.jwk,
  });
  setDefaultProfileName(localProfile.profile);
  return localProfile;
}

async function loginWithProfile(profile) {
  const keystore = loadKeystore(profile.handle);
  if (!keystore || !keystore.jwk) {
    return {
      status: 'reauth_required',
      profile: profile.profile,
      handle: profile.handle,
      name: profile.name,
      sprite: profile.sprite,
      server: profile.server || null,
      lease_expires_at: null,
      message: '本地 profile 缺少可用认证材料，请重新创建角色。',
    };
  }

  const server = await discoverServer(profile.server);
  const timestamp = Date.now();
  const signature = signLoginProof(profile.handle, timestamp, keystore.jwk);
  const response = await requestJson(server, 'POST', '/api/login', {
    body: {
      handle: profile.handle,
      timestamp,
      signature,
      deviceId: keystore.deviceId,
    },
  });

  const nextProfile = {
    ...profile,
    name: response.name || profile.name,
    sprite: response.sprite || profile.sprite,
    handle: response.handle || profile.handle,
    server,
    token: response.token,
    expiresAt: response.expires_at || new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    leaseExpiresAt: response.lease_expires_at || null,
    lastUsedAt: new Date().toISOString(),
  };

  saveProfile(nextProfile);
  setDefaultProfileName(nextProfile.profile);

  return {
    status: response.status,
    profile: nextProfile.profile,
    handle: nextProfile.handle,
    name: nextProfile.name,
    sprite: nextProfile.sprite,
    server: nextProfile.server,
    lease_expires_at: nextProfile.leaseExpiresAt,
    message: response.message,
    token: nextProfile.token,
  };
}

function normalizeLoginMode(options = {}) {
  if (options.respawn === true) return 'spawn';
  if (options.loginMode === 'spawn') return 'spawn';
  return 'resume';
}

async function loginWithProfileMode(profile, options = {}) {
  const keystore = loadKeystore(profile.handle);
  if (!keystore || !keystore.jwk) {
    return {
      status: 'reauth_required',
      profile: profile.profile,
      handle: profile.handle,
      name: profile.name,
      sprite: profile.sprite,
      server: profile.server || null,
      lease_expires_at: null,
      message: '本地 profile 缺少可用认证材料，请重新创建角色。',
    };
  }

  const server = await discoverServer(profile.server);
  const timestamp = Date.now();
  const signature = signLoginProof(profile.handle, timestamp, keystore.jwk);
  const loginMode = normalizeLoginMode(options);
  const response = await requestJson(server, 'POST', '/api/login', {
    body: {
      handle: profile.handle,
      timestamp,
      signature,
      deviceId: keystore.deviceId,
      loginMode,
      respawn: loginMode === 'spawn',
    },
  });

  const nextProfile = {
    ...profile,
    name: response.name || profile.name,
    sprite: response.sprite || profile.sprite,
    handle: response.handle || profile.handle,
    server,
    token: response.token,
    expiresAt: response.expires_at || new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    leaseExpiresAt: response.lease_expires_at || null,
    lastUsedAt: new Date().toISOString(),
  };

  saveProfile(nextProfile);
  setDefaultProfileName(nextProfile.profile);

  return {
    status: response.status,
    profile: nextProfile.profile,
    handle: nextProfile.handle,
    name: nextProfile.name,
    sprite: nextProfile.sprite,
    server: nextProfile.server,
    lease_expires_at: nextProfile.leaseExpiresAt,
    message: response.message,
    token: nextProfile.token,
    login_mode: response.login_mode || loginMode,
  };
}

module.exports = {
  createProfile,
  loginWithProfile: loginWithProfileMode,
  generateKeyMaterial,
  signLoginProof,
  normalizeProfileName,
  normalizeLoginMode,
};
