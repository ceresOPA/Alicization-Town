// rest-api.js — REST API 路由层，核心逻辑由 server.js 提供
module.exports = function setupRestApi(app, ctx) {
  const {
    gameState, io, crypto,
    createPlayer, removePlayer, movePlayer, playerSay, playerInteract,
    resolveDestination, navigatePlayer, getMapDirectory, getZoneAt
  } = ctx;

  const apiSessions = new Map(); // token -> { playerId, lastActivity }
  const API_TIMEOUT = 5 * 60 * 1000;

  // 定期清理不活跃的 API 玩家
  setInterval(() => {
    const now = Date.now();
    for (const [token, session] of apiSessions) {
      if (now - session.lastActivity > API_TIMEOUT) {
        removePlayer(session.playerId);
        apiSessions.delete(token);
        console.log(`🧹 清理不活跃的 API 玩家: ${session.playerId}`);
      }
    }
  }, 60000);

  // 鉴权中间件
  function apiAuth(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !apiSessions.has(token)) {
      return res.status(401).json({ error: '未加入小镇，请先调用 POST /api/join' });
    }
    const session = apiSessions.get(token);
    session.lastActivity = Date.now();
    req.playerId = session.playerId;
    req.player = gameState.players[session.playerId];
    if (!req.player) {
      apiSessions.delete(token);
      return res.status(401).json({ error: '会话已过期，请重新 join' });
    }
    next();
  }

  // GET /api/status — 查询某个名字是否已在小镇
  app.get('/api/status', (req, res) => {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: '需要提供 name 参数' });
    const player = Object.values(gameState.players).find(p => p.name === name);
    if (player) {
      return res.json({ online: true, position: { x: player.x, y: player.y }, zone: player.currentZoneName });
    }
    res.json({ online: false });
  });

  // POST /api/join — 加入小镇（同名自动恢复已有会话）
  app.post('/api/join', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '需要提供 name' });

    // 同名去重
    const existingPlayerId = Object.keys(gameState.players).find(id => gameState.players[id].name === name);
    if (existingPlayerId) {
      for (const [existingToken, session] of apiSessions) {
        if (session.playerId === existingPlayerId) {
          session.lastActivity = Date.now();
          const player = gameState.players[existingPlayerId];
          console.log(`🔄 API 玩家恢复会话: ${name} (${existingPlayerId})`);
          return res.json({ token: existingToken, playerId: existingPlayerId, name, position: { x: player.x, y: player.y }, resumed: true });
        }
      }
    }

    const token = crypto.randomUUID();
    const playerId = `api_${token.slice(0, 8)}`;
    createPlayer(playerId, name);

    apiSessions.set(token, { playerId, lastActivity: Date.now() });
    io.emit('stateUpdate', gameState.players);

    console.log(`🌐 API 玩家加入: ${name} (${playerId})`);
    res.json({ token, playerId, name, position: { x: 5, y: 5 } });
  });

  // POST /api/walk — 移动
  app.post('/api/walk', apiAuth, (req, res) => {
    const { direction, steps } = req.body;
    if (!['N', 'S', 'E', 'W'].includes(direction)) {
      return res.status(400).json({ error: 'direction 必须是 N/S/E/W' });
    }
    const { moved, blocked } = movePlayer(req.player, direction, steps || 1);
    res.json({ moved, position: { x: req.player.x, y: req.player.y }, zone: req.player.currentZoneName, blocked });
  });

  // POST /api/say — 说话
  app.post('/api/say', apiAuth, (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: '需要提供 text' });
    playerSay(req.playerId, text);
    res.json({ ok: true });
  });

  // GET /api/look — 环顾四周
  app.get('/api/look', apiAuth, (req, res) => {
    const player = req.player;
    const nearby = Object.values(gameState.players)
      .filter(p => p.id !== req.playerId && p.name !== 'Observer')
      .map(p => ({
        name: p.name,
        distance: Math.abs(p.x - player.x) + Math.abs(p.y - player.y),
        zone: p.currentZoneName,
        message: p.message || undefined
      }))
      .filter(p => p.distance <= 10);
    res.json({ position: { x: player.x, y: player.y }, zone: player.currentZoneName, zoneDesc: player.currentZoneDesc, nearby });
  });

  // GET /api/map — 获取地图名录
  app.get('/api/map', (req, res) => {
    res.json(getMapDirectory());
  });

  // POST /api/interact — 与当前区域互动
  app.post('/api/interact', apiAuth, (req, res) => {
    const result = playerInteract(req.playerId);
    if (!result) return res.status(400).json({ error: '互动失败' });
    res.json(result);
  });

  // POST /api/navigate — 自动寻路到目标
  app.post('/api/navigate', apiAuth, (req, res) => {
    const player = req.player;
    const { destination, x, y } = req.body;

    let targetX, targetY, targetName;
    if (destination) {
      const resolved = resolveDestination(destination);
      if (!resolved) return res.status(404).json({ error: `找不到地点: ${destination}` });
      targetX = resolved.x; targetY = resolved.y; targetName = resolved.name;
    } else if (x !== undefined && y !== undefined) {
      targetX = Math.round(x); targetY = Math.round(y);
      const zone = getZoneAt(targetX, targetY);
      targetName = zone ? zone.name : '小镇街道';
    } else {
      return res.status(400).json({ error: '需要提供 destination(地点名) 或 x,y 坐标' });
    }

    const result = navigatePlayer(player, targetX, targetY);
    if (!result) return res.status(400).json({ error: '无法找到通往目标的路径' });
    if (!result.moved && result.moved !== undefined) {
      return res.json({ message: '你已经在目标位置了', position: { x: player.x, y: player.y }, zone: player.currentZoneName });
    }
    res.json({ destination: targetName, ...result });
  });

  // POST /api/leave — 离开小镇
  app.post('/api/leave', apiAuth, (req, res) => {
    const name = req.player.name;
    removePlayer(req.playerId);
    const token = req.headers['authorization']?.replace('Bearer ', '');
    apiSessions.delete(token);
    console.log(`👋 API 玩家离开: ${name}`);
    res.json({ ok: true });
  });
};
