// 小镇接口路由入口
const { Router } = require('express');
const worldEngine = require('./engine/world-engine');
const { RequestContext } = require('./request-context');

const router = Router();
router.use(require('express').json());
const IDLE_AFTER_MS = Number(process.env.ALICIZATION_TOWN_IDLE_AFTER_MS || 30_000);
const LEASE_TTL_MS = Number(process.env.ALICIZATION_TOWN_LEASE_TTL_MS || 180_000);

function requireSession(req, res, next) {
  const { handle, error } = RequestContext.fromRequest(req, { required: true, touchLease: true });
  if (!handle) return res.status(401).json({ error });
  req.requestHandle = handle;
  req.drainPerceptions = () => worldEngine.perception.drain(handle.playerId);
  req.drainNewMessages = () => worldEngine.drainChat(handle.playerId);
  return next();
}

function maybeSession(req, _res, next) {
  const { handle } = RequestContext.fromRequest(req, { required: false, touchLease: true });
  req.requestHandle = handle;
  next();
}

router.get('/characters', (_req, res) => {
  res.json({ characters: worldEngine.getCharacterList() });
});

router.get('/map', maybeSession, (req, res) => {
  res.json({ directory: worldEngine.readMap(req.requestHandle?.playerId || null) });
});

router.get('/players', (_req, res) => {
  const raw = worldEngine.getAllPlayers();
  const result = {};
  const now = Date.now();
  for (const [id, player] of Object.entries(raw)) {
    const heartbeatAge = player.lastHeartbeatAt ? now - player.lastHeartbeatAt : Infinity;
    const actionAge = player.lastActionAt ? now - player.lastActionAt : Infinity;
    result[id] = {
      id,
      name: player.name,
      x: player.x,
      y: player.y,
      zone: player.currentZoneName,
      sprite: player.sprite,
      isThinking: player.isThinking,
      isNPC: player.isNPC || false,
      message: player.message || '',
      lastActionAt: player.lastActionAt || null,
      lastHeartbeatAt: player.lastHeartbeatAt || null,
      presenceState: heartbeatAge > LEASE_TTL_MS ? 'offline' : (actionAge > IDLE_AFTER_MS ? 'idle' : 'active'),
    };
  }
  res.json({ players: result });
});

router.post('/profiles/create', (req, res) => {
  const { name, sprite, publicKey } = req.body || {};
  if (!name) return res.status(400).json({ error: '缺少 name 字段' });
  if (!sprite) return res.status(400).json({ error: '缺少 sprite 字段' });
  if (!publicKey) return res.status(400).json({ error: '缺少 publicKey 字段' });
  const profile = worldEngine.createProfile(name, sprite, publicKey);
  res.json(profile);
});

router.post('/login', (req, res) => {
  const { handle, timestamp, signature } = req.body || {};
  if (!handle) return res.status(400).json({ error: '缺少 handle 字段' });
  if (!timestamp) return res.status(400).json({ error: '缺少 timestamp 字段' });
  if (!signature) return res.status(400).json({ error: '缺少 signature 字段' });
  const result = worldEngine.loginProfile(handle, timestamp, signature);
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  res.json(result);
});

router.post('/session/heartbeat', (req, res) => {
  const { handle, error } = RequestContext.fromRequest(req, { required: true, touchLease: false });
  if (!handle || !handle.token) return res.status(401).json({ error: error || '缺少登录凭证，请重新 login。' });
  const result = worldEngine.heartbeat(handle.token);
  if (!result) return res.status(401).json({ error: '登录已失效，请重新 login。' });
  res.json(result);
});

router.post('/logout', (req, res) => {
  const { handle, error } = RequestContext.fromRequest(req, { required: true, touchLease: false });
  if (!handle || !handle.token) return res.status(401).json({ error: error || '缺少登录凭证，请重新 login。' });
  if (!handle.logout()) return res.status(401).json({ error: '登录已失效，请重新 login。' });
  res.json({ ok: true });
});

router.get('/look', requireSession, (req, res) => {
  const result = worldEngine.look(req.requestHandle.playerId);
  if (!result) return res.status(404).json({ error: '玩家不存在' });
  if (result.conflict) return res.status(409).json({ error: '动作冲突，请稍后重试' });
  res.json({ ...result, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
});

router.post('/walk', requireSession, (req, res) => {
  const { direction, steps } = req.body || {};
  if (!direction || !['N', 'S', 'W', 'E'].includes(direction)) {
    return res.status(400).json({ error: '无效方向，可选: N/S/W/E' });
  }
  if (!steps || steps < 1) return res.status(400).json({ error: '步数必须 >= 1' });
  const result = worldEngine.move(req.requestHandle.playerId, direction, Math.floor(steps));
  if (!result) return res.status(404).json({ error: '玩家不存在' });
  if (result.conflict) return res.status(409).json({ error: '动作冲突，请稍后重试' });
  res.json({ ...result, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
});

router.post('/chat', requireSession, (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: '缺少 text 字段' });
  const result = worldEngine.chat(req.requestHandle.playerId, text);
  if (!result) return res.status(404).json({ error: '玩家不存在' });
  res.json({ ...result, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
});

router.post('/interact', requireSession, (req, res) => {
  const result = worldEngine.interact(req.requestHandle.playerId);
  if (!result) return res.status(404).json({ error: '玩家不存在' });
  if (result.conflict) return res.status(409).json({ error: '动作冲突，请稍后重试' });
  res.json({ ...result, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
});

router.put('/status', requireSession, (req, res) => {
  const { isThinking } = req.body || {};
  worldEngine.setThinking(req.requestHandle.playerId, isThinking);
  res.json({ ok: true, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
});

router.get('/perceptions', requireSession, (req, res) => {
  res.json({ perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
});

router.get('/npcs', (req, res) => {
  const npcManager = req.app.locals.npcManager;
  if (!npcManager) return res.json({ npcs: [] });
  res.json({ npcs: npcManager.getNpcList() });
});

function parseChatCursor(rawCursor) {
  if (!rawCursor) return null;
  const match = String(rawCursor).match(/^(\d+):(\d+)$/);
  if (match) {
    return {
      time: Number(match[1]),
      id: Number(match[2]),
    };
  }
  const numeric = Number(rawCursor);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric >= 1_000_000_000_000 ? { time: numeric, id: 0 } : { time: 0, id: numeric };
}

function encodeChatCursor(entry) {
  return `${entry.time}:${entry.id}`;
}

function isAfterCursor(entry, cursor) {
  if (!cursor) return true;
  if (entry.time !== cursor.time) return entry.time > cursor.time;
  return entry.id > cursor.id;
}

router.get('/chat', maybeSession, (req, res) => {
  const rawSince = typeof req.query.since === 'string' ? req.query.since : '';
  const sinceCursor = parseChatCursor(rawSince);
  const hasSince = rawSince.length > 0 && sinceCursor !== null;
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const all = worldEngine.getChatHistory();
  const filtered = hasSince
    ? all.filter((message) => isAfterCursor(message, sinceCursor)).slice(0, limit)
    : all.slice(-limit);
  const cursor = filtered.length > 0
    ? encodeChatCursor(filtered[filtered.length - 1])
    : (hasSince ? rawSince : '');
  res.json({ messages: filtered, cursor });
});

module.exports = router;
