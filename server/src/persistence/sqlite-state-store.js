const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DATABASE_FILE } = require('../config/service-config');

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

class SQLiteStateStore {
  constructor(databaseFile) {
    ensureDirectory(path.dirname(databaseFile));
    this.database = new DatabaseSync(databaseFile);
    this.initializeSchema();
    this.resetRuntimeSessions();
  }

  initializeSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        handle TEXT,
        name TEXT NOT NULL,
        sprite TEXT NOT NULL,
        public_key TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        lease_expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS active_profile_sessions (
        profile_id TEXT PRIMARY KEY,
        token TEXT NOT NULL
      );
    `);

    const columns = new Set(
      this.database.prepare(`PRAGMA table_info(profiles)`).all().map((column) => column.name),
    );
    if (!columns.has('handle')) {
      this.database.exec(`ALTER TABLE profiles ADD COLUMN handle TEXT;`);
    }
    if (!columns.has('public_key')) {
      this.database.exec(`ALTER TABLE profiles ADD COLUMN public_key TEXT;`);
    }
    if (!columns.has('last_x')) {
      this.database.exec(`ALTER TABLE profiles ADD COLUMN last_x INTEGER;`);
    }
    if (!columns.has('last_y')) {
      this.database.exec(`ALTER TABLE profiles ADD COLUMN last_y INTEGER;`);
    }
    if (!columns.has('last_direction')) {
      this.database.exec(`ALTER TABLE profiles ADD COLUMN last_direction TEXT;`);
    }

    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_public_key ON profiles(public_key);
    `);
  }

  resetRuntimeSessions() {
    this.database.exec(`
      DELETE FROM auth_sessions;
      DELETE FROM active_profile_sessions;
    `);
  }

  createProfile(profile) {
    const existing = this.getProfileByPublicKey(profile.publicKey);
    if (existing) return existing;

    this.database.prepare(`
      INSERT INTO profiles (id, handle, name, sprite, public_key, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.id,
      profile.handle,
      profile.name,
      profile.sprite,
      profile.publicKey,
      profile.createdAt,
      profile.lastUsedAt || null,
    );

    return this.getProfileByHandle(profile.handle);
  }

  getProfile(id) {
    const row = this.database.prepare(`
      SELECT id, handle, name, sprite, public_key AS publicKey, created_at AS createdAt, last_used_at AS lastUsedAt,
        last_x AS lastX, last_y AS lastY, last_direction AS lastDirection
      FROM profiles
      WHERE id = ?
    `).get(id);
    return row || null;
  }

  getProfileByHandle(handle) {
    const row = this.database.prepare(`
      SELECT id, handle, name, sprite, public_key AS publicKey, created_at AS createdAt, last_used_at AS lastUsedAt,
        last_x AS lastX, last_y AS lastY, last_direction AS lastDirection
      FROM profiles
      WHERE handle = ?
    `).get(handle);
    return row || null;
  }

  getProfileByPublicKey(publicKey) {
    const row = this.database.prepare(`
      SELECT id, handle, name, sprite, public_key AS publicKey, created_at AS createdAt, last_used_at AS lastUsedAt,
        last_x AS lastX, last_y AS lastY, last_direction AS lastDirection
      FROM profiles
      WHERE public_key = ?
    `).get(publicKey);
    return row || null;
  }

  updateProfileLastUsed(id, lastUsedAt) {
    this.database.prepare(`
      UPDATE profiles
      SET last_used_at = ?
      WHERE id = ?
    `).run(lastUsedAt, id);
  }

  updateProfileSprite(id, sprite) {
    this.database.prepare(`
      UPDATE profiles
      SET sprite = ?
      WHERE id = ?
    `).run(sprite, id);
  }

  updateProfilePosition(id, { x, y, direction }) {
    this.database.prepare(`
      UPDATE profiles
      SET last_x = ?, last_y = ?, last_direction = ?
      WHERE id = ?
    `).run(x, y, direction || null, id);
  }

  saveAuthSession(session) {
    this.database.prepare(`
      INSERT OR REPLACE INTO auth_sessions (token, profile_id, player_id, issued_at, expires_at, lease_expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      session.token,
      session.id,
      session.playerId,
      session.issuedAt,
      session.expiresAt,
      session.leaseExpiresAt,
    );
  }

  getAuthSession(token) {
    const row = this.database.prepare(`
      SELECT token, profile_id AS id, player_id AS playerId, issued_at AS issuedAt, expires_at AS expiresAt, lease_expires_at AS leaseExpiresAt
      FROM auth_sessions
      WHERE token = ?
    `).get(token);
    return row || null;
  }

  deleteAuthSession(token) {
    const existing = this.getAuthSession(token);
    if (!existing) return null;
    this.database.prepare(`DELETE FROM auth_sessions WHERE token = ?`).run(token);
    return existing;
  }

  listExpiredAuthSessionTokens(now) {
    return this.database.prepare(`
      SELECT token
      FROM auth_sessions
      WHERE expires_at <= ? OR lease_expires_at <= ?
    `).all(now, now).map((row) => row.token);
  }

  getActiveToken(profileId) {
    const row = this.database.prepare(`
      SELECT token
      FROM active_profile_sessions
      WHERE profile_id = ?
    `).get(profileId);
    return row ? row.token : null;
  }

  setActiveToken(profileId, token) {
    this.database.prepare(`
      INSERT OR REPLACE INTO active_profile_sessions (profile_id, token)
      VALUES (?, ?)
    `).run(profileId, token);
  }

  clearActiveToken(profileId, token = null) {
    if (token) {
      this.database.prepare(`
        DELETE FROM active_profile_sessions
        WHERE profile_id = ? AND token = ?
      `).run(profileId, token);
      return;
    }

    this.database.prepare(`
      DELETE FROM active_profile_sessions
      WHERE profile_id = ?
    `).run(profileId);
  }
}

const sqliteStateStore = new SQLiteStateStore(DATABASE_FILE);

module.exports = {
  SQLiteStateStore,
  sqliteStateStore,
};
