// 世界状态引擎，负责小镇行为与运行时状态管理
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { ZONE_INTERACTIONS, ZONE_CATEGORY_MAP } = require('../data/interactions');
const { CHARACTER_SPRITES } = require('../data/characters');
const { describeRelativeDirection } = require('./relative-direction');
const { findPath, findNearestWalkable } = require('./pathfinding');
const actionLock = require('./action-lock');
const {
  MESSAGE_TTL_MS,
  INTERACTION_TTL_MS,
  NEARBY_RANGE,
  MAX_CHAT_MESSAGES,
  MAX_PLAYER_ACTIVITIES,
  IDLE_AFTER_MS,
  LEASE_TTL_MS,
  TOKEN_TTL_MS,
  MOVE_TICK_MS,
  LOGIN_PROOF_TTL_MS,
  SERVER_MACHINE_ID,
  SNOWFLAKE_EPOCH_MS,
} = require('../config/service-config');
const { sqliteStateStore } = require('../persistence/sqlite-state-store');
const perception = require('./perception');

let worldMap = null;
let collisionMap = [];
let semanticZones = [];
let mapDirectory = [];
let nextSpriteIndex = 0;
let lastSnowflakeTimestamp = 0;
let snowflakeSequence = 0;
let nextChatCursor = 0;

const players = {};
const chatHistory = [];
const playerActivities = {};
const walkAborts = new Map();
const events = new EventEmitter();

/** @type {import('./plugin-manager').PluginManager|null} */
let pluginManager = null;

function setPluginManager(pm) {
  pluginManager = pm;
}

function deriveHandle(publicKey) {
  return `at_${crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 24)}`;
}

function init(mapPath) {
  if (!fs.existsSync(mapPath)) {
    console.error('❌ 找不到 map.tmj！');
    return;
  }

  worldMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  collisionMap = new Array(worldMap.width * worldMap.height).fill(0);

  const collisionLayers = ['BaseNature', 'Nature', 'Building', 'BuildingTop'];
  worldMap.layers.forEach((layer) => {
    if (layer.type === 'tilelayer' && collisionLayers.includes(layer.name)) {
      layer.data.forEach((tileId, index) => {
        if (tileId !== 0) collisionMap[index] = 1;
      });
    }
  });

  const zoneLayer = worldMap.layers.find((layer) => layer.name === 'SemanticZones' || layer.type === 'objectgroup');
  if (zoneLayer && zoneLayer.objects) {
    semanticZones = zoneLayer.objects;
    console.log(`🗺️ 成功加载 ${semanticZones.length} 个语义区域`);
  }

  const NAVIGABLE_TYPES = new Set(['building', 'landmark']);
  const usedIds = new Set();
  mapDirectory = semanticZones.map((zone) => {
    const normalizedName = (zone.name || '').toLowerCase();
    let category = null;
    let interactionType = null;
    for (const [matcher, matchedCategory] of ZONE_CATEGORY_MAP) {
      if (matcher.test(normalizedName)) {
        category = matchedCategory;
        break;
      }
    }
    for (const type of Object.keys(ZONE_INTERACTIONS)) {
      if (ZONE_INTERACTIONS[type][category]) {
        interactionType = type;
        break;
      }
    }
    const navigable = interactionType ? NAVIGABLE_TYPES.has(interactionType) : false;
    const base = category || normalizedName.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const gridX = Math.floor((zone.x + zone.width / 2) / worldMap.tilewidth);
    const gridY = Math.floor((zone.y + zone.height / 2) / worldMap.tileheight);
    // Deterministic 4-char hex hash from name + position
    const seed = `${zone.name}:${gridX}:${gridY}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    const suffix = ((hash >>> 0) % 0xFFFF).toString(16).padStart(4, '0');
    let id = `${base}#${suffix}`;
    // Collision guard (extremely unlikely but safe)
    while (usedIds.has(id)) id = `${base}#${(parseInt(id.split('#')[1], 16) + 1).toString(16).padStart(4, '0')}`;
    usedIds.add(id);

    return {
      id,
      name: zone.name,
      navigable,
      x: gridX,
      y: gridY,
      description: zone.properties?.find((prop) => prop.name === 'description')?.value || '',
    };
  });
}

function getZoneAt(gridX, gridY) {
  if (!worldMap || semanticZones.length === 0) return null;
  const px = gridX * worldMap.tilewidth + worldMap.tilewidth / 2;
  const py = gridY * worldMap.tileheight + worldMap.tileheight / 2;
  const margin = worldMap.tilewidth * 1.5;

  let closest = null;
  let minDist = Infinity;
  for (const zone of semanticZones) {
    const dx = Math.max(zone.x - px, 0, px - (zone.x + zone.width));
    const dy = Math.max(zone.y - py, 0, py - (zone.y + zone.height));
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= margin && dist < minDist) {
      minDist = dist;
      closest = zone;
    }
  }
  return closest;
}

function getInteractionForZone(zone) {
  if (!zone) return { action: '环顾四周', result: '这里是空旷的街道，没有什么特别的。' };
  const normalizedName = (zone.name || '').toLowerCase();

  // ── 插件路径：优先从 pluginManager 获取交互 ───────────────────────────
  if (pluginManager && pluginManager.hasPlugins()) {
    const category = _resolveCategory(normalizedName);
    if (category) {
      const pluginPool = pluginManager.getInteractions(category);
      if (pluginPool.length > 0) {
        return pluginPool[Math.floor(Math.random() * pluginPool.length)];
      }
    }
  }

  // ── Legacy 路径：直接使用硬编码数据 ────────────────────────────────────
  const zoneType = zone.type || 'building';
  let category = null;
  for (const [matcher, matchedCategory] of ZONE_CATEGORY_MAP) {
    if (matcher.test(normalizedName)) {
      category = matchedCategory;
      break;
    }
  }
  const pool = ZONE_INTERACTIONS[zoneType]?.[category];
  if (!pool) return { action: '四处看看', result: `你仔细观察了${zone.name}，感受着这里的氛围。` };
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 从插件 zone matchers 和 legacy matchers 中解析分类名。
 * 插件 matchers 优先（允许覆盖）。
 */
function _resolveCategory(normalizedName) {
  // 先查插件注册的 matchers
  if (pluginManager) {
    const pluginMatchers = pluginManager.getZoneMatchers();
    for (const [matcher, category] of pluginMatchers) {
      if (matcher.test(normalizedName)) return category;
    }
  }
  // fallback 到内置 matchers
  for (const [matcher, category] of ZONE_CATEGORY_MAP) {
    if (matcher.test(normalizedName)) return category;
  }
  return null;
}

function zoneInfo(player) {
  const zone = getZoneAt(player.x, player.y);
  player.currentZoneName = zone ? zone.name : '小镇街道';
  player.currentZoneDesc = zone?.properties?.find((prop) => prop.name === 'description')?.value || (zone ? '' : '空旷的街道');
}

function getPresenceState(player) {
  if (!player) return 'offline';
  const now = Date.now();
  if (!player.lastHeartbeatAt || now - player.lastHeartbeatAt > LEASE_TTL_MS) return 'offline';
  if (!player.lastActionAt || now - player.lastActionAt > IDLE_AFTER_MS) return 'idle';
  return 'active';
}

function sanitize(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    direction: player.lastDirection,
    sprite: player.sprite,
    zone: player.currentZoneName,
    zoneDesc: player.currentZoneDesc,
    isThinking: player.isThinking,
    isNPC: player.isNPC || false,
    message: player.message || null,
    lastActionAt: player.lastActionAt || null,
    lastHeartbeatAt: player.lastHeartbeatAt || null,
    presenceState: getPresenceState(player),
  };
}

function addChat(playerId, name, message, x, y) {
  const entry = { id: ++nextChatCursor, playerId, time: Date.now(), name, message, x, y };
  chatHistory.push(entry);
  if (chatHistory.length > MAX_CHAT_MESSAGES) chatHistory.shift();
  events.emit('chat', entry);
}

function drainChat(playerId) {
  const player = players[playerId];
  if (!player) return [];
  const cursor = player.lastChatCursor || 0;
  const newMessages = chatHistory.filter((m) => m.id > cursor && m.playerId !== playerId);
  if (newMessages.length > 0) {
    player.lastChatCursor = newMessages[newMessages.length - 1].id;
  }
  return newMessages;
}

function addActivity(playerId, activity) {
  if (!playerActivities[playerId]) playerActivities[playerId] = [];
  const list = playerActivities[playerId];
  list.push({ time: Date.now(), ...activity });
  if (list.length > MAX_PLAYER_ACTIVITIES) list.shift();
  const player = players[playerId];
  if (player) {
    events.emit('activity', { id: playerId, name: player.name, sprite: player.sprite, activities: list });
  }
}

/**
 * 供插件推送活动记录（通过 pluginManager.setActivityEmitter 调用）
 */
function recordPluginActivity(playerId, text, type) {
  addActivity(playerId, { type: type || 'plugin', text });
}

function broadcast() {
  events.emit('stateChange');
}

function nextSnowflakeId() {
  let timestamp = Date.now();
  if (timestamp < lastSnowflakeTimestamp) {
    timestamp = lastSnowflakeTimestamp;
  }

  if (timestamp === lastSnowflakeTimestamp) {
    snowflakeSequence = (snowflakeSequence + 1) & 0xfff;
    if (snowflakeSequence === 0) {
      do {
        timestamp = Date.now();
      } while (timestamp <= lastSnowflakeTimestamp);
    }
  } else {
    snowflakeSequence = 0;
  }

  lastSnowflakeTimestamp = timestamp;
  const high = BigInt(timestamp - SNOWFLAKE_EPOCH_MS) << 22n;
  const machine = BigInt(SERVER_MACHINE_ID & 0x3ff) << 12n;
  const sequence = BigInt(snowflakeSequence);
  return (high | machine | sequence).toString();
}

function createProfile(name, sprite, publicKey) {
  const assignedSprite = CHARACTER_SPRITES.includes(sprite) ? sprite : 'Boy';
  const createdProfile = sqliteStateStore.createProfile({
    id: nextSnowflakeId(),
    handle: deriveHandle(publicKey),
    name,
    sprite: assignedSprite,
    publicKey,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  });
  return { handle: createdProfile.handle, name: createdProfile.name, sprite: createdProfile.sprite };
}

function getProfile(id) {
  return sqliteStateStore.getProfile(id);
}

function getProfileByHandle(handle) {
  return sqliteStateStore.getProfileByHandle(handle);
}

function verifyLoginProof(profile, timestamp, signature) {
  if (!profile || !profile.publicKey || typeof signature !== 'string') return false;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() - timestamp) > LOGIN_PROOF_TTL_MS) return false;

  const publicKey = crypto.createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: profile.publicKey },
  });

  try {
    return crypto.verify(
      null,
      Buffer.from(`alicization-town:login:${profile.handle}:${timestamp}`, 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

function destroyToken(token, { evictPlayer = true } = {}) {
  const existing = sqliteStateStore.deleteAuthSession(token);
  if (!existing) return;
  sqliteStateStore.clearActiveToken(existing.id, token);
  if (evictPlayer) removePlayer(existing.id);
}

function loginProfile(handle, timestamp, signature) {
  const profile = getProfileByHandle(handle) || getProfile(handle);
  if (!profile) return { error: '未找到对应 profile，请先使用 login 的创建模式创建角色。', code: 404 };
  if (!verifyLoginProof(profile, timestamp, signature)) {
    return { error: '认证失败，请重新 login。', code: 401 };
  }

  const previousToken = sqliteStateStore.getActiveToken(profile.id);
  const hadActiveSession = Boolean(previousToken && sqliteStateStore.getAuthSession(previousToken));
  if (previousToken) destroyToken(previousToken, { evictPlayer: true });
  sqliteStateStore.clearActiveToken(profile.id);

  const token = crypto.randomUUID();
  const now = Date.now();
  const player = join(profile.id, profile.name, profile.sprite, { trackActivity: true });
  const session = {
    id: profile.id,
    playerId: profile.id,
    token,
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_MS,
    leaseExpiresAt: now + LEASE_TTL_MS,
  };
  sqliteStateStore.saveAuthSession(session);
  sqliteStateStore.setActiveToken(profile.id, token);
  touchHeartbeat(profile.id);
  touchAction(profile.id);

  sqliteStateStore.updateProfileLastUsed(profile.id, new Date(now).toISOString());

  return {
    status: hadActiveSession ? 'took_over_session' : 'authenticated',
    handle: profile.handle,
    name: profile.name,
    sprite: profile.sprite,
    token,
    expires_at: new Date(session.expiresAt).toISOString(),
    lease_expires_at: new Date(session.leaseExpiresAt).toISOString(),
    player: sanitize(player),
    message: hadActiveSession ? `已接管角色 ${profile.name} 的在线会话。` : `已登录角色 ${profile.name}。`,
  };
}

function getTokenSession(token, { touchLease = false } = {}) {
  const session = sqliteStateStore.getAuthSession(token);
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt <= now) {
    destroyToken(token);
    return null;
  }
  if (touchLease) {
    session.leaseExpiresAt = now + LEASE_TTL_MS;
    sqliteStateStore.saveAuthSession(session);
    // Auto-rejoin if player was ghost-cleaned but token is still valid
    if (!players[session.id]) {
      const profile = sqliteStateStore.getProfile(session.id);
      if (profile) {
        join(profile.id, profile.name, profile.sprite, { trackActivity: true });
      }
    }
    touchHeartbeat(session.id);
  }
  return session;
}

function heartbeat(token) {
  const session = getTokenSession(token, { touchLease: true });
  if (!session) return null;
  return {
    ok: true,
    id: session.id,
    expires_at: new Date(session.expiresAt).toISOString(),
    lease_expires_at: new Date(session.leaseExpiresAt).toISOString(),
  };
}

function logout(token) {
  if (!sqliteStateStore.getAuthSession(token)) return false;
  destroyToken(token, { evictPlayer: true });
  return true;
}

function pruneExpiredSessions() {
  const now = Date.now();

  const expiredTokens = sqliteStateStore.listExpiredAuthSessionTokens(now);
  for (const token of expiredTokens) {
    destroyToken(token);
  }

  // Remove non-NPC players whose heartbeat lease has expired (ghost cleanup)
  let changed = false;
  for (const playerId of Object.keys(players)) {
    const player = players[playerId];
    if (!player || player.isNPC) continue;
    if (getPresenceState(player) === 'offline') {
      _removePlayerSilent(playerId);
      changed = true;
    }
  }
  if (changed) broadcast();
}

const cleanupTimer = setInterval(pruneExpiredSessions, 1_000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

function shutdown() {
  clearInterval(cleanupTimer);
}

function emitPerception(type, playerId, playerName, x, y, data = {}) {
  perception.onWorldEvent({ type, playerId, playerName, position: { x, y }, data }, players);
}

function join(playerId, name, sprite, options = {}) {
  let assignedSprite = sprite;
  if (!assignedSprite || !CHARACTER_SPRITES.includes(assignedSprite)) {
    assignedSprite = CHARACTER_SPRITES[nextSpriteIndex % CHARACTER_SPRITES.length];
    nextSpriteIndex += 1;
  }

  const spawnX = 5;
  const spawnY = 5;
  const zone = getZoneAt(spawnX, spawnY);
  const now = Date.now();
  players[playerId] = {
    id: playerId,
    name,
    x: spawnX,
    y: spawnY,
    lastDirection: 'S',
    message: '',
    interactionText: '',
    interactionIcon: '',
    interactionSound: '',
    isThinking: false,
    sprite: assignedSprite,
    currentZoneName: zone ? zone.name : '小镇街道',
    currentZoneDesc: zone?.properties?.find((prop) => prop.name === 'description')?.value || '空旷的街道',
    lastHeartbeatAt: now,
    lastActionAt: options.trackActivity === false ? null : now,
    lastChatCursor: nextChatCursor,
  };
  addActivity(playerId, { type: 'join', text: `加入了小镇 (角色: ${assignedSprite})` });
  emitPerception('join', playerId, name, spawnX, spawnY, { sprite: assignedSprite });
  broadcast();
  return players[playerId];
}

function _removePlayerSilent(playerId) {
  const player = players[playerId];
  if (!player) return;
  walkAborts.get(playerId)?.abort();
  walkAborts.delete(playerId);
  emitPerception('leave', playerId, player.name, player.x, player.y);
  delete players[playerId];
  delete playerActivities[playerId];
  perception.cleanup(playerId);
  actionLock.remove(playerId);
}

function removePlayer(playerId) {
  _removePlayerSilent(playerId);
  broadcast();
}

function refreshZoneInfo(playerId) {
  const player = players[playerId];
  if (!player) return;
  zoneInfo(player);
  broadcast();
}

function touchHeartbeat(playerId) {
  const player = players[playerId];
  if (!player) return;
  player.lastHeartbeatAt = Date.now();
}

function touchAction(playerId) {
  const player = players[playerId];
  if (!player) return;
  const now = Date.now();
  player.lastActionAt = now;
  player.lastHeartbeatAt = now;
}

function relativeToAbsolute(facing, forward, right, originX, originY) {
  const fwd = forward || 0;
  const rgt = right || 0;
  // facing → (forwardDx, forwardDy, rightDx, rightDy)
  switch (facing) {
    case 'N': return { x: originX + rgt, y: originY - fwd };
    case 'S': return { x: originX - rgt, y: originY + fwd };
    case 'E': return { x: originX + fwd, y: originY + rgt };
    case 'W': return { x: originX - fwd, y: originY - rgt };
    default:  return { x: originX - rgt, y: originY + fwd };
  }
}

function resolveTarget({ to, x, y, forward, right }, player) {
  if (typeof x === 'number' && typeof y === 'number') {
    return { targetX: Math.floor(x), targetY: Math.floor(y), resolvedZone: null };
  }
  if (typeof to === 'string' && to.length > 0) {
    const nav = mapDirectory.filter((z) => z.navigable);
    const zone = nav.find((z) => z.id === to.trim().toLowerCase());
    if (zone) return { targetX: zone.x, targetY: zone.y, resolvedZone: zone.name };
    const validIds = nav.map((z) => z.id).join(', ');
    const safeTo = to.slice(0, 64).replace(/[<>"'&]/g, '');
    return { error: `未知地点: "${safeTo}"。请使用 map 获取的精确 id。可用: ${validIds}` };
  }
  if ((typeof forward === 'number' || typeof right === 'number') && player) {
    const abs = relativeToAbsolute(player.lastDirection, forward || 0, right || 0, player.x, player.y);
    return { targetX: abs.x, targetY: abs.y, resolvedZone: null };
  }
  return { error: '需要指定目标: --to <id> 或 --x <X> --y <Y> 或 --forward/--right <步数>' };
}

function directionFromDelta(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

async function move(playerId, target) {
  const player = players[playerId];
  if (!player) return null;
  touchAction(playerId);

  // Cancel any in-flight walk for this player
  walkAborts.get(playerId)?.abort();
  const ac = new AbortController();
  walkAborts.set(playerId, ac);

  const resolved = resolveTarget(target, player);
  if (resolved.error) return { error: resolved.error };

  let { targetX, targetY } = resolved;
  const { resolvedZone } = resolved;
  let wasBlocked = false;

  // If the exact target is blocked, find nearest walkable tile
  if (targetX < 0 || targetX >= worldMap.width || targetY < 0 || targetY >= worldMap.height
      || collisionMap[targetY * worldMap.width + targetX] === 1) {
    const nearest = findNearestWalkable(collisionMap, worldMap.width, worldMap.height, targetX, targetY);
    if (!nearest) return { error: '目标位置完全不可达。' };
    wasBlocked = true;
    targetX = nearest.x;
    targetY = nearest.y;
  }

  // Already at target
  if (player.x === targetX && player.y === targetY) {
    zoneInfo(player);
    return {
      player: sanitize(player),
      pathLength: 0,
      arrived: true,
      wasBlocked: false,
      targetZone: resolvedZone || player.currentZoneName,
    };
  }

  const { path, reachable } = findPath(collisionMap, worldMap.width, worldMap.height, player.x, player.y, targetX, targetY);
  if (!reachable || path.length < 2) return { error: '无法到达目标位置，路径被完全阻断。' };

  // Walk tick-by-tick (skip index 0 which is current position)
  for (let i = 1; i < path.length; i += 1) {
    if (ac.signal.aborted || !players[playerId]) break;
    const prev = path[i - 1];
    const step = path[i];
    player.x = step.x;
    player.y = step.y;
    player.lastDirection = directionFromDelta(step.x - prev.x, step.y - prev.y);
    touchAction(playerId);
    broadcast();
    if (i < path.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, MOVE_TICK_MS));
    }
  }

  walkAborts.delete(playerId);

  // If cancelled or player removed mid-walk, return partial result
  if (ac.signal.aborted || !players[playerId]) {
    return {
      player: players[playerId] ? sanitize(players[playerId]) : null,
      pathLength: 0,
      arrived: false,
      wasBlocked,
      cancelled: true,
      targetZone: resolvedZone || null,
    };
  }

  zoneInfo(player);
  emitPerception('move', playerId, player.name, player.x, player.y, {
    pathLength: path.length - 1,
    zone: player.currentZoneName,
  });
  addActivity(playerId, { type: 'move', text: `移动到 (${player.x}, ${player.y}) - ${player.currentZoneName}` });
  broadcast();

  return {
    player: sanitize(player),
    pathLength: path.length - 1,
    arrived: true,
    wasBlocked,
    targetZone: resolvedZone || player.currentZoneName,
  };
}

function chat(playerId, text) {
  const player = players[playerId];
  if (!player) return null;
  touchAction(playerId);
  player.message = text;
  player.lastSpeakAt = Date.now();
  addChat(playerId, player.name, text, player.x, player.y);
  addActivity(playerId, { type: 'chat', text: `说: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"` });
  emitPerception('chat', playerId, player.name, player.x, player.y, { text });
  broadcast();
  setTimeout(() => {
    if (players[playerId]) {
      players[playerId].message = '';
      broadcast();
    }
  }, MESSAGE_TTL_MS);
  return { ok: true };
}

function interact(playerId, item) {
  const player = players[playerId];
  if (!player) return null;
  touchAction(playerId);
  const zone = getZoneAt(player.x, player.y);
  const result = getInteractionForZone(zone);
  player.interactionText = result.action;
  player.interactionIcon = result.icon || '';
  player.interactionSound = result.sound || 'interact';
  emitPerception('interact', playerId, player.name, player.x, player.y, { zone: zone ? zone.name : '小镇街道', action: result.action });
  broadcast();
  setTimeout(() => {
    if (players[playerId]) {
      players[playerId].interactionText = '';
      players[playerId].interactionIcon = '';
      players[playerId].interactionSound = '';
      broadcast();
    }
  }, INTERACTION_TTL_MS);
  const entry = {
    time: Date.now(),
    playerId,
    name: player.name,
    isNPC: !!player.isNPC,
    zone: zone ? zone.name : '小镇街道',
    action: result.action,
    result: result.result,
    item: item || null,
  };
  events.emit('interaction', entry);
  addActivity(playerId, { type: 'interact', text: `在${zone ? zone.name : '街道'}: ${result.action}` });
  return { zone: zone ? zone.name : '小镇街道', ...result };
}

function look(playerId) {
  const player = players[playerId];
  if (!player) return null;
  touchAction(playerId);
  const nearby = [];
  for (const [id, other] of Object.entries(players)) {
    if (id === playerId || other.name === 'Observer') continue;
    const distance = Math.abs(other.x - player.x) + Math.abs(other.y - player.y);
    if (distance <= NEARBY_RANGE) {
      nearby.push({
        id: other.id,
        name: other.name,
        distance,
        relativeDirection: describeRelativeDirection(other.x - player.x, other.y - player.y, player.lastDirection),
        zone: other.currentZoneName,
        message: other.message || null,
        lastSpeakAt: other.lastSpeakAt || null,
        sprite: other.sprite,
        presenceState: getPresenceState(other),
      });
    }
  }
  return { player: sanitize(player), nearby };
}

function readMap(playerId) {
  if (playerId && players[playerId]) {
    touchAction(playerId);
    broadcast();
  }
  return mapDirectory.filter((z) => z.navigable);
}

function setThinking(playerId, isThinking) {
  const player = players[playerId];
  if (!player) return;
  touchHeartbeat(playerId);
  player.isThinking = Boolean(isThinking);
  broadcast();
}

function sanitizeAllPlayers() {
  const result = {};
  for (const [id, player] of Object.entries(players)) {
    result[id] = sanitize(player);
  }
  return result;
}

module.exports = {
  init,
  events,
  perception,
  setPluginManager,
  createProfile,
  loginProfile,
  heartbeat,
  logout,
  getTokenSession,
  getProfile,
  getProfileByHandle,
  pruneExpiredSessions,
  join,
  removePlayer,
  move,
  chat,
  interact,
  look,
  readMap,
  setThinking,
  touchAction,
  getMapDirectory: () => mapDirectory,
  getCharacterList: () => CHARACTER_SPRITES.slice(),
  getAllPlayers: () => players,
  sanitizeAllPlayers,
  getChatHistory: () => chatHistory,
  getWorldMap: () => worldMap,
  drainChat,
  refreshZoneInfo,
  recordPluginActivity,
  shutdown,
};
