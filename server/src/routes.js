// 小镇接口路由入口
const { Router } = require('express');
const worldEngine = require('./engine/world-engine');
const { RequestContext } = require('./request-context');
const actionLock = require('./engine/action-lock');

const router = Router();
router.use(require('express').json());

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
  res.json({ players: worldEngine.sanitizeAllPlayers() });
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
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  if (!token) return res.status(401).json({ error: '缺少登录凭证，请重新 login。' });
  const result = worldEngine.heartbeat(token);
  if (!result) return res.status(401).json({ error: '登录已失效，请重新 login。' });
  res.json(result);
});

router.post('/logout', (req, res) => {
  const { handle, error } = RequestContext.fromRequest(req, { required: true, touchLease: false });
  if (!handle || !handle.token) return res.status(401).json({ error: error || '缺少登录凭证，请重新 login。' });
  if (!handle.logout()) return res.status(401).json({ error: '登录已失效，请重新 login。' });
  res.json({ ok: true });
});

router.get('/look', requireSession, async (req, res) => {
  const release = await actionLock.acquire(req.requestHandle.playerId);
  try {
    const result = worldEngine.look(req.requestHandle.playerId);
    if (!result) return res.status(404).json({ error: '玩家不存在' });
    res.json({ ...result, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
  } finally { release(); }
});

router.post('/walk', requireSession, async (req, res) => {
  const { to, x, y, forward, right } = req.body || {};

  // -- 参数类型与边界校验 --
  if (to !== undefined && (typeof to !== 'string' || to.length === 0 || to.length > 64)) {
    return res.status(400).json({ error: 'to 参数必须为 1-64 字符的字符串' });
  }
  if (x !== undefined && !Number.isFinite(x)) {
    return res.status(400).json({ error: 'x 必须为有限数值' });
  }
  if (y !== undefined && !Number.isFinite(y)) {
    return res.status(400).json({ error: 'y 必须为有限数值' });
  }
  if (forward !== undefined && !Number.isFinite(forward)) {
    return res.status(400).json({ error: 'forward 必须为有限数值' });
  }
  if (right !== undefined && !Number.isFinite(right)) {
    return res.status(400).json({ error: 'right 必须为有限数值' });
  }

  const hasAbsoluteCoord = typeof x === 'number' && typeof y === 'number';
  const hasRelative = typeof forward === 'number' || typeof right === 'number';
  if (!to && !hasAbsoluteCoord && !hasRelative) {
    return res.status(400).json({ error: '需要指定目标: to(地名)、x+y(坐标)、或 forward/right(相对移动)' });
  }
  const release = await actionLock.acquire(req.requestHandle.playerId);
  try {
    const result = await worldEngine.move(req.requestHandle.playerId, { to, x, y, forward, right });
    if (!result) return res.status(404).json({ error: '玩家不存在' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ...result, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
  } finally { release(); }
});

router.post('/chat', requireSession, async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: '缺少 text 字段' });
  const release = await actionLock.acquire(req.requestHandle.playerId);
  try {
    const result = worldEngine.chat(req.requestHandle.playerId, text);
    if (!result) return res.status(404).json({ error: '玩家不存在' });
    res.json({ ...result, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
  } finally { release(); }
});

router.post('/interact', requireSession, async (req, res) => {
  const release = await actionLock.acquire(req.requestHandle.playerId);
  try {
    const result = worldEngine.interact(req.requestHandle.playerId);
    if (!result) return res.status(404).json({ error: '玩家不存在' });
    res.json({ ...result, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
  } finally { release(); }
});

router.post('/memories/recall', requireSession, async (req, res) => {
  const { partnerId, location, since, limit } = req.body || {};
  const numericSince = since == null ? null : Number(since);
  const numericLimit = limit == null ? undefined : Number(limit);
  if (since != null && !Number.isFinite(numericSince)) {
    return res.status(400).json({ error: 'since must be a finite timestamp' });
  }
  if (limit != null && !Number.isFinite(numericLimit)) {
    return res.status(400).json({ error: 'limit must be a finite number' });
  }
  const release = await actionLock.acquire(req.requestHandle.playerId);
  try {
    const memories = worldEngine.recallMemories(req.requestHandle.playerId, {
      partnerId: typeof partnerId === 'string' && partnerId ? partnerId : null,
      location: typeof location === 'string' && location ? location : null,
      since: numericSince,
      limit: numericLimit,
    });
    if (!memories) return res.status(404).json({ error: 'player not found' });
    res.json({ memories });
  } finally { release(); }
});

router.put('/status', requireSession, async (req, res) => {
  const release = await actionLock.acquire(req.requestHandle.playerId);
  try {
    const { isThinking } = req.body || {};
    worldEngine.setThinking(req.requestHandle.playerId, isThinking);
    res.json({ ok: true, perceptions: req.drainPerceptions(), newMessages: req.drainNewMessages() });
  } finally { release(); }
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
