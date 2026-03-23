// 世界状态引擎，负责小镇行为与运行时状态管理
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { ZONE_INTERACTIONS, ZONE_CATEGORY_MAP } = require('../data/interactions');
const { CHARACTER_SPRITES } = require('../data/characters');
const { describeRelativeDirection } = require('./relative-direction');
const PathPlanner = require('./path-planner');
const PathExecutor = require('./path-executor');
const {
  MESSAGE_TTL_MS,
  INTERACTION_TTL_MS,
  MAX_STEPS,
  NEARBY_RANGE,
  MAX_CHAT_MESSAGES,
  MAX_PLAYER_ACTIVITIES,
  IDLE_AFTER_MS,
  LEASE_TTL_MS,
  TOKEN_TTL_MS,
  LOGIN_PROOF_TTL_MS,
  SERVER_MACHINE_ID,
  SNOWFLAKE_EPOCH_MS,
} = require('../config/service-config');
const { sqliteStateStore } = require('../persistence/sqlite-state-store');
const perception = require('./perception');

let pathPlanner = null;
let pathExecutor = null;

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
const events = new EventEmitter();

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

  mapDirectory = semanticZones.map((zone) => ({
    name: zone.name,
    x: Math.floor((zone.x + zone.width / 2) / worldMap.tilewidth),
    y: Math.floor((zone.y + zone.height / 2) / worldMap.tileheight),
    description: zone.properties?.find((prop) => prop.name === 'description')?.value || '',
  }));

  // 初始化路径规划器和路径执行器
  pathPlanner = new PathPlanner(mapPath, collisionMap, worldMap);
  pathExecutor = new PathExecutor({
    move,
    getZoneAt,
    getAllPlayers: () => players
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
  const zoneType = zone.type || 'building';
  const normalizedName = (zone.name || '').toLowerCase();
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

function addChat(name, message, x, y) {
  const entry = { id: ++nextChatCursor, time: Date.now(), name, message, x, y };
  chatHistory.push(entry);
  if (chatHistory.length > MAX_CHAT_MESSAGES) chatHistory.shift();
  events.emit('chat', entry);
}

function drainChat(playerId) {
  const player = players[playerId];
  if (!player) return [];
  const cursor = player.lastChatCursor || 0;
  const newMessages = chatHistory.filter((m) => m.id > cursor && m.name !== player.name);
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
  // Token validity: only expiresAt matters (24h TTL)
  if (session.expiresAt <= now) {
    destroyToken(token);
    return null;
  }
  // Lease is for presence display only; renew on any authenticated action
  if (touchLease) {
    session.leaseExpiresAt = now + LEASE_TTL_MS;
    sqliteStateStore.saveAuthSession(session);
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

  for (const playerId of Object.keys(players)) {
    const player = players[playerId];
    if (player && getPresenceState(player) === 'idle') {
      broadcast();
    }
  }
}

const cleanupTimer = setInterval(pruneExpiredSessions, 1_000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

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

function removePlayer(playerId) {
  const player = players[playerId];
  if (!player) return;
  emitPerception('leave', playerId, player.name, player.x, player.y);
  delete players[playerId];
  delete playerActivities[playerId];
  perception.cleanup(playerId);
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

function move(playerId, direction, steps) {
  const player = players[playerId];
  if (!player) return null;
  touchAction(playerId);
  player.lastDirection = direction;
  const clamped = Math.max(1, Math.min(steps, MAX_STEPS));
  let dx = 0;
  let dy = 0;
  
  // 处理对角线方向
  switch (direction) {
    case 'E':
      dx = 1;
      break;
    case 'W':
      dx = -1;
      break;
    case 'S':
      dy = 1;
      break;
    case 'N':
      dy = -1;
      break;
    case 'NE':
      dx = 1;
      dy = -1;
      break;
    case 'NW':
      dx = -1;
      dy = -1;
      break;
    case 'SE':
      dx = 1;
      dy = 1;
      break;
    case 'SW':
      dx = -1;
      dy = 1;
      break;
  }
  
  let actual = 0;
  let blocked = false;
  for (let index = 0; index < clamped; index += 1) {
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (nx < 0 || nx >= worldMap.width || ny < 0 || ny >= worldMap.height) {
      blocked = true;
      break;
    }
    if (collisionMap[ny * worldMap.width + nx] === 1) {
      blocked = true;
      break;
    }
    player.x = nx;
    player.y = ny;
    actual += 1;
  }
  zoneInfo(player);
  emitPerception('move', playerId, player.name, player.x, player.y, { direction, steps: actual, zone: player.currentZoneName });
  addActivity(playerId, { type: 'move', text: `移动到 (${player.x}, ${player.y}) - ${player.currentZoneName}` });
  broadcast();
  return { player: sanitize(player), actualSteps: actual, blocked };
}

function chat(playerId, text) {
  const player = players[playerId];
  if (!player) return null;
  touchAction(playerId);
  player.message = text;
  player.lastSpeakAt = Date.now();
  addChat(player.name, text, player.x, player.y);
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

function interact(playerId) {
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
    name: player.name,
    zone: zone ? zone.name : '小镇街道',
    action: result.action,
    result: result.result,
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
  return mapDirectory;
}

function setThinking(playerId, isThinking) {
  const player = players[playerId];
  if (!player) return;
  touchHeartbeat(playerId);
  player.isThinking = Boolean(isThinking);
  broadcast();
}

function findPath(playerId, targetX, targetY) {
  const player = players[playerId];
  if (!player || !pathPlanner) return null;
  
  const path = pathPlanner.findPath(player.x, player.y, targetX, targetY);
  if (!path) return { error: '无法找到路径' };
  
  return { path };
}

function moveAlongPath(playerId, path) {
  const player = players[playerId];
  if (!player || !pathExecutor) return null;
  
  const result = pathExecutor.executePath(playerId, path);
  if (!result.success) return { error: '路径执行失败' };
  
  return { 
    player: sanitize(player), 
    actualSteps: result.actualSteps, 
    blocked: result.blocked 
  };
}

function getWaypoints() {
  return pathPlanner ? pathPlanner.getWaypoints() : [];
}

function walkToPoint(playerId, pointId) {
  const player = players[playerId];
  if (!player || !pathPlanner || !pathExecutor) return null;
  
  // 找到路标点
  const waypoint = pathPlanner.getWaypointById(pointId);
  if (!waypoint) return { success: false, message: '路标点不存在' };
  
  // 寻找路径
  const path = pathPlanner.findPath(player.x, player.y, waypoint.x, waypoint.y);
  if (!path) return { success: false, message: '无法找到路径' };
  
  // 执行路径，传递目标路标点 ID
  const result = pathExecutor.executePath(playerId, path, pointId);
  if (!result.success) {
    if (result.blocked) {
      return { success: false, message: '路径执行被阻塞' };
    } else if (!result.reachedTarget) {
      return { success: false, message: '未到达目标区域' };
    } else {
      return { success: false, message: '路径执行失败' };
    }
  }
  
  return { 
    success: true, 
    actualSteps: result.actualSteps, 
    blocked: result.blocked,
    reachedTarget: result.reachedTarget,
    player: sanitize(player)
  };
}

module.exports = {
  init,
  events,
  perception,
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
  findPath,
  moveAlongPath,
  getWaypoints,
  walkToPoint,
  getZoneAt,
  getMapDirectory: () => mapDirectory,
  getCharacterList: () => CHARACTER_SPRITES.slice(),
  getAllPlayers: () => players,
  getChatHistory: () => chatHistory,
  getWorldMap: () => worldMap,
  drainChat,
};
