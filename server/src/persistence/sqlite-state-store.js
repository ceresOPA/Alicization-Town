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

      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        name TEXT NOT NULL,
        level INTEGER DEFAULT 1,
        xp INTEGER DEFAULT 0,
        hp INTEGER,
        max_hp INTEGER,
        str INTEGER DEFAULT 1,
        dex INTEGER DEFAULT 1,
        int INTEGER DEFAULT 1,
        vit INTEGER DEFAULT 1,
        gold INTEGER DEFAULT 0,
        stat_points INTEGER DEFAULT 0,
        skill_points INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(id)
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

    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_public_key ON profiles(public_key);
      CREATE INDEX IF NOT EXISTS idx_characters_profile_id ON characters(profile_id);
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
      SELECT id, handle, name, sprite, public_key AS publicKey, created_at AS createdAt, last_used_at AS lastUsedAt
      FROM profiles
      WHERE id = ?
    `).get(id);
    return row || null;
  }

  getProfileByHandle(handle) {
    const row = this.database.prepare(`
      SELECT id, handle, name, sprite, public_key AS publicKey, created_at AS createdAt, last_used_at AS lastUsedAt
      FROM profiles
      WHERE handle = ?
    `).get(handle);
    return row || null;
  }

  getProfileByPublicKey(publicKey) {
    const row = this.database.prepare(`
      SELECT id, handle, name, sprite, public_key AS publicKey, created_at AS createdAt, last_used_at AS lastUsedAt
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
      WHERE expires_at <= ?
    `).all(now).map((row) => row.token);
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

  createCharacter(character) {
    const existing = this.getCharacterByProfileId(character.profileId);
    if (existing) return existing;

    this.database.prepare(`
      INSERT INTO characters (id, profile_id, name, level, xp, hp, max_hp, str, dex, int, vit, gold, stat_points, skill_points, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      character.id,
      character.profileId,
      character.name,
      character.level || 1,
      character.xp || 0,
      character.hp,
      character.maxHp,
      character.str || 1,
      character.dex || 1,
      character.int || 1,
      character.vit || 1,
      character.gold || 0,
      character.statPoints || 0,
      character.skillPoints || 0,
      character.createdAt,
      character.updatedAt,
    );

    return this.getCharacter(character.id);
  }

  getCharacter(id) {
    const row = this.database.prepare(`
      SELECT id, profile_id AS profileId, name, level, xp, hp, max_hp AS maxHp, str, dex, int, vit, gold, stat_points AS statPoints, skill_points AS skillPoints, created_at AS createdAt, updated_at AS updatedAt
      FROM characters
      WHERE id = ?
    `).get(id);
    return row || null;
  }

  getCharacterByProfileId(profileId) {
    const row = this.database.prepare(`
      SELECT id, profile_id AS profileId, name, level, xp, hp, max_hp AS maxHp, str, dex, int, vit, gold, stat_points AS statPoints, skill_points AS skillPoints, created_at AS createdAt, updated_at AS updatedAt
      FROM characters
      WHERE profile_id = ?
    `).get(profileId);
    return row || null;
  }

  updateCharacter(id, updates) {
    const character = this.getCharacter(id);
    if (!character) return null;

    const updated = { ...character, ...updates, updatedAt: new Date().toISOString() };

    this.database.prepare(`
      UPDATE characters
      SET name = ?, level = ?, xp = ?, hp = ?, max_hp = ?, str = ?, dex = ?, int = ?, vit = ?, gold = ?, stat_points = ?, skill_points = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.name,
      updated.level,
      updated.xp,
      updated.hp,
      updated.maxHp,
      updated.str,
      updated.dex,
      updated.int,
      updated.vit,
      updated.gold,
      updated.statPoints,
      updated.skillPoints,
      updated.updatedAt,
      id,
    );

    return this.getCharacter(id);
  }

  addCharacterXp(id, xpAmount) {
    const character = this.getCharacter(id);
    if (!character) return null;

    const newXp = character.xp + xpAmount;
    const newLevel = Math.floor(newXp / 100) + 1;
    const leveledUp = newLevel > character.level;
    const statPointsGained = leveledUp ? (newLevel - character.level) * 3 : 0;

    this.database.prepare(`
      UPDATE characters
      SET xp = ?, level = ?, stat_points = stat_points + ?, updated_at = ?
      WHERE id = ?
    `).run(newXp, newLevel, statPointsGained, new Date().toISOString(), id);

    return this.getCharacter(id);
  }

  addCharacterGold(id, goldAmount) {
    const character = this.getCharacter(id);
    if (!character) return null;

    this.database.prepare(`
      UPDATE characters
      SET gold = gold + ?, updated_at = ?
      WHERE id = ?
    `).run(goldAmount, new Date().toISOString(), id);

    return this.getCharacter(id);
  }

  updateCharacterHp(id, hp) {
    const character = this.getCharacter(id);
    if (!character) return null;

    this.database.prepare(`
      UPDATE characters
      SET hp = ?, updated_at = ?
      WHERE id = ?
    `).run(hp, new Date().toISOString(), id);

    return this.getCharacter(id);
  }

  allocateStatPoint(id, stat) {
    const character = this.getCharacter(id);
    if (!character || character.statPoints <= 0) return null;

    const validStats = ['str', 'dex', 'int', 'vit'];
    if (!validStats.includes(stat)) return null;

    this.database.prepare(`
      UPDATE characters
      SET ${stat} = ${stat} + 1, stat_points = stat_points - 1, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id);

    return this.getCharacter(id);
  }
}

const sqliteStateStore = new SQLiteStateStore(DATABASE_FILE);

module.exports = {
  SQLiteStateStore,
  sqliteStateStore,
};
