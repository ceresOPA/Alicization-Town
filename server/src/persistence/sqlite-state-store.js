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

      CREATE TABLE IF NOT EXISTS agent_memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        partner_id TEXT,
        location TEXT,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_retrieved_at INTEGER,
        retrieval_count INTEGER NOT NULL DEFAULT 0
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

    const memoryColumns = new Set(
      this.database.prepare(`PRAGMA table_info(agent_memories)`).all().map((column) => column.name),
    );
    if (!memoryColumns.has('partner_id')) {
      this.database.exec(`ALTER TABLE agent_memories ADD COLUMN partner_id TEXT;`);
    }
    if (!memoryColumns.has('location')) {
      this.database.exec(`ALTER TABLE agent_memories ADD COLUMN location TEXT;`);
    }
    if (!memoryColumns.has('kind')) {
      this.database.exec(`ALTER TABLE agent_memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'summary';`);
    }
    if (!memoryColumns.has('content')) {
      this.database.exec(`ALTER TABLE agent_memories ADD COLUMN content TEXT NOT NULL DEFAULT '';`);
    }
    if (!memoryColumns.has('metadata_json')) {
      this.database.exec(`ALTER TABLE agent_memories ADD COLUMN metadata_json TEXT;`);
    }
    if (!memoryColumns.has('created_at')) {
      this.database.exec(`ALTER TABLE agent_memories ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!memoryColumns.has('updated_at')) {
      this.database.exec(`ALTER TABLE agent_memories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!memoryColumns.has('last_retrieved_at')) {
      this.database.exec(`ALTER TABLE agent_memories ADD COLUMN last_retrieved_at INTEGER;`);
    }
    if (!memoryColumns.has('retrieval_count')) {
      this.database.exec(`ALTER TABLE agent_memories ADD COLUMN retrieval_count INTEGER NOT NULL DEFAULT 0;`);
    }

    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_public_key ON profiles(public_key);
      CREATE INDEX IF NOT EXISTS idx_agent_memories_agent_created_at
        ON agent_memories(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_memories_agent_partner_created_at
        ON agent_memories(agent_id, partner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_memories_agent_location_created_at
        ON agent_memories(agent_id, location, created_at DESC);
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

  saveAgentMemory(memory) {
    if (!memory || !memory.id || !memory.agentId || !memory.content) {
      throw new Error('saveAgentMemory requires id, agentId, and content');
    }

    const now = Number.isFinite(memory.updatedAt) ? memory.updatedAt : Date.now();
    const createdAt = Number.isFinite(memory.createdAt) ? memory.createdAt : now;
    const metadataJson = memory.metadata == null
      ? null
      : (typeof memory.metadata === 'string' ? memory.metadata : JSON.stringify(memory.metadata));

    this.database.prepare(`
      INSERT INTO agent_memories (
        id,
        agent_id,
        partner_id,
        location,
        kind,
        content,
        metadata_json,
        created_at,
        updated_at,
        last_retrieved_at,
        retrieval_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent_id = excluded.agent_id,
        partner_id = excluded.partner_id,
        location = excluded.location,
        kind = excluded.kind,
        content = excluded.content,
        metadata_json = excluded.metadata_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        last_retrieved_at = excluded.last_retrieved_at,
        retrieval_count = excluded.retrieval_count
    `).run(
      memory.id,
      memory.agentId,
      memory.partnerId || null,
      memory.location || null,
      memory.kind || 'summary',
      memory.content,
      metadataJson,
      createdAt,
      now,
      Number.isFinite(memory.lastRetrievedAt) ? memory.lastRetrievedAt : null,
      Number.isFinite(memory.retrievalCount) ? memory.retrievalCount : 0,
    );

    return this.getAgentMemory(memory.id, memory.agentId);
  }

  getAgentMemory(id, agentId = null) {
    const row = this.database.prepare(`
      SELECT
        id,
        agent_id AS agentId,
        partner_id AS partnerId,
        location,
        kind,
        content,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        last_retrieved_at AS lastRetrievedAt,
        retrieval_count AS retrievalCount
      FROM agent_memories
      WHERE id = ?
        AND (? IS NULL OR agent_id = ?)
    `).get(id, agentId, agentId);
    return this.mapAgentMemoryRow(row);
  }

  listAgentMemories(agentId, { limit = 20 } = {}) {
    if (!agentId) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    return this.database.prepare(`
      SELECT
        id,
        agent_id AS agentId,
        partner_id AS partnerId,
        location,
        kind,
        content,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        last_retrieved_at AS lastRetrievedAt,
        retrieval_count AS retrievalCount
      FROM agent_memories
      WHERE agent_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(agentId, safeLimit).map((row) => this.mapAgentMemoryRow(row));
  }

  retrieveAgentMemories({
    agentId,
    partnerId = null,
    location = null,
    since = null,
    limit = 5,
  }) {
    if (!agentId) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 50));
    const sinceTimestamp = Number.isFinite(since) ? since : null;
    const rows = this.database.prepare(`
      SELECT
        id,
        agent_id AS agentId,
        partner_id AS partnerId,
        location,
        kind,
        content,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        last_retrieved_at AS lastRetrievedAt,
        retrieval_count AS retrievalCount,
        (
          CASE
            WHEN ? IS NOT NULL AND partner_id = ? THEN 2
            ELSE 0
          END +
          CASE
            WHEN ? IS NOT NULL AND location = ? THEN 1
            ELSE 0
          END
        ) AS retrievalScore
      FROM agent_memories
      WHERE agent_id = ?
        AND (? IS NULL OR created_at >= ?)
      ORDER BY retrievalScore DESC, created_at DESC, id DESC
      LIMIT ?
    `).all(
      partnerId, partnerId,
      location, location,
      agentId,
      sinceTimestamp, sinceTimestamp,
      safeLimit,
    );

    if (rows.length > 0) {
      const retrievedAt = Date.now();
      const touchMemory = this.database.prepare(`
        UPDATE agent_memories
        SET last_retrieved_at = ?, retrieval_count = retrieval_count + 1
        WHERE id = ?
      `);
      for (const row of rows) {
        touchMemory.run(retrievedAt, row.id);
      }
      for (const row of rows) {
        row.lastRetrievedAt = retrievedAt;
        row.retrievalCount += 1;
      }
    }

    return rows.map((row) => this.mapAgentMemoryRow(row));
  }

  mapAgentMemoryRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      agentId: row.agentId,
      partnerId: row.partnerId || null,
      location: row.location || null,
      kind: row.kind,
      content: row.content,
      metadata: this.parseJson(row.metadataJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastRetrievedAt: row.lastRetrievedAt || null,
      retrievalCount: row.retrievalCount || 0,
      retrievalScore: Number.isFinite(row.retrievalScore) ? row.retrievalScore : undefined,
    };
  }

  parseJson(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}

const sqliteStateStore = new SQLiteStateStore(DATABASE_FILE);

module.exports = {
  SQLiteStateStore,
  sqliteStateStore,
};
