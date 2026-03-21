const {
  getDefaultProfileName,
  loadProfile,
  saveProfile,
} = require('./storage');
const { createProfile, loginWithProfile } = require('./auth-client');
const { requestJson } = require('./http-client');

function resolveProfileName(profile) {
  return profile || getDefaultProfileName();
}

function getProfileOrThrow(profileName) {
  const resolvedProfile = resolveProfileName(profileName);
  if (!resolvedProfile) {
    throw new Error('本地还没有 profile，请使用 login 的创建模式创建角色。');
  }

  const profile = loadProfile(resolvedProfile);
  if (!profile) {
    throw new Error(`Profile "${resolvedProfile}" 不存在。`);
  }

  return profile;
}

class SessionHandle {
  constructor(profileName = null) {
    this.profileName = profileName || null;
  }

  bindProfile(profile) {
    if (profile?.profile) this.profileName = profile.profile;
    return profile;
  }

  resolveProfileName(explicitProfile) {
    return resolveProfileName(explicitProfile || this.profileName);
  }

  getProfileOrThrow(explicitProfile) {
    return this.bindProfile(getProfileOrThrow(explicitProfile || this.profileName));
  }

  async createProfile(options) {
    const created = await createProfile(options);
    return this.bindProfile(created);
  }

  async login(options = {}) {
    if (options.create) {
      const missingFields = [];
      if (!options.name) missingFields.push('name');
      if (!options.sprite) missingFields.push('sprite');
      if (missingFields.length > 0) {
        return {
          status: 'needs_creation',
          profile: null,
          handle: null,
          name: null,
          sprite: null,
          server: null,
          lease_expires_at: null,
          missing_fields: missingFields,
          message: '创建角色前还缺少必要字段。',
        };
      }

      const createdProfile = await this.createProfile({
        profile: options.profile,
        name: options.name,
        sprite: options.sprite,
        server: options.server,
      });
      const createdLogin = await loginWithProfile(createdProfile, options);
      this.profileName = createdProfile.profile;
      return {
        ...createdLogin,
        status: createdLogin.status === 'took_over_session' ? 'took_over_session' : 'created_and_authenticated',
      };
    }

    const resolvedProfile = this.resolveProfileName(options.profile);
    if (!resolvedProfile) {
      return {
        status: 'needs_creation',
        profile: null,
        handle: null,
        name: null,
        sprite: null,
        server: null,
        lease_expires_at: null,
        missing_fields: ['name', 'sprite'],
        message: '本地还没有 profile，请使用 login 的创建模式创建角色。',
      };
    }

    const profile = this.getProfileOrThrow(resolvedProfile);
    this.profileName = resolvedProfile;
    return loginWithProfile(profile, options);
  }

  async heartbeat() {
    const profile = this.getProfileOrThrow();
    if (!profile.token) {
      return { ok: false, reason: 'missing_token' };
    }

    try {
      const result = await requestJson(profile.server, 'POST', '/api/session/heartbeat', {
        headers: { Authorization: `Bearer ${profile.token}` },
      });
      const nextProfile = {
        ...profile,
        leaseExpiresAt: result.lease_expires_at || profile.leaseExpiresAt,
        expiresAt: result.expires_at || profile.expiresAt,
        lastUsedAt: new Date().toISOString(),
      };
      saveProfile(nextProfile);
      this.bindProfile(nextProfile);
      return { ok: true, profile: nextProfile, result };
    } catch (error) {
      if (error.statusCode === 401) {
        const nextProfile = { ...profile, token: null, leaseExpiresAt: null };
        saveProfile(nextProfile);
        this.bindProfile(nextProfile);
        return { ok: false, reason: 'unauthorized' };
      }
      throw error;
    }
  }

  async ensureOnline() {
    const resolvedProfile = this.resolveProfileName();
    if (!resolvedProfile) {
      return {
        status: 'needs_creation',
        profile: null,
        handle: null,
        message: '本地还没有 profile，请先使用 login 的创建模式创建角色。',
      };
    }

    this.profileName = resolvedProfile;
    const heartbeatResult = await this.heartbeat();
    if (heartbeatResult.ok) {
      return { profile: heartbeatResult.profile, login: null };
    }

    const loginResult = await this.login({ profile: resolvedProfile });
    if (loginResult.status === 'needs_creation' || loginResult.status === 'reauth_required') {
      return { profile: null, login: loginResult };
    }

    return {
      profile: this.getProfileOrThrow(resolvedProfile),
      login: loginResult,
    };
  }

  async request(method, apiPath, body) {
    const ensured = await this.ensureOnline();
    if (!ensured.profile) {
      return { auth: ensured.login, result: null };
    }

    const result = await requestWithProfile(ensured.profile, method, apiPath, body);
    return { auth: ensured.login, result, profile: this.bindProfile(ensured.profile) };
  }

  async logout() {
    const resolvedProfile = this.resolveProfileName();
    if (!resolvedProfile) return { ok: false };
    const profile = loadProfile(resolvedProfile);
    if (!profile || !profile.token) return { ok: false };

    try {
      await requestJson(profile.server, 'POST', '/api/logout', {
        headers: { Authorization: `Bearer ${profile.token}` },
      });
    } catch {}

    const nextProfile = {
      ...profile,
      token: null,
      leaseExpiresAt: null,
    };
    saveProfile(nextProfile);
    this.bindProfile(nextProfile);
    return { ok: true };
  }
}

async function requestWithProfile(profile, method, apiPath, body) {
  return requestJson(profile.server, method, apiPath, {
    body,
    headers: profile.token ? { Authorization: `Bearer ${profile.token}` } : undefined,
  });
}

async function runAuthenticated(method, apiPath, body, profileName) {
  return new SessionHandle(profileName).request(method, apiPath, body);
}

async function logoutProfile(profileName) {
  return new SessionHandle(profileName).logout();
}

async function heartbeat(profileName) {
  return new SessionHandle(profileName).heartbeat();
}

async function ensureOnline(profileName) {
  return new SessionHandle(profileName).ensureOnline();
}

async function login(options = {}) {
  return new SessionHandle(options.profile || null).login(options);
}

module.exports = {
  SessionHandle,
  resolveProfileName,
  getProfileOrThrow,
  requestWithProfile,
  runAuthenticated,
  logoutProfile,
  heartbeat,
  ensureOnline,
  login,
};
