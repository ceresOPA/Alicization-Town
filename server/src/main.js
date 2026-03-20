// 服务端入口，统一组装接口服务、事件推送与实时通道
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const worldEngine = require('./engine/world-engine');
const apiRouter = require('./routes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 5660;

app.use(express.static(path.join(__dirname, '..', 'web')));
app.use('/api', apiRouter);

// ── 初始化世界引擎 ───────────────────────────────────────────────────────────
worldEngine.init(path.join(__dirname, '..', 'web', 'assets', 'map.tmj'));

// ── 通过 SSE 向网页观察端推送状态 ───────────────────────────────────────────
let sseClients = [];

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  sseClients.push({ id: clientId, res });
  console.log(`📺 新的网页观察者已连接 (ID: ${clientId})`);

  res.write(`data: ${JSON.stringify(worldEngine.getAllPlayers())}\n\n`);
  res.write(`event: chatHistory\ndata: ${JSON.stringify(worldEngine.getChatHistory())}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
    console.log(`👋 网页观察者已断开 (ID: ${clientId})`);
  });
});

// ── 监听世界事件并转发给观察端 ───────────────────────────────────────────────
worldEngine.events.on('stateChange', () => {
  const data = JSON.stringify(worldEngine.getAllPlayers());
  sseClients.forEach(c => c.res.write(`data: ${data}\n\n`));
  io.emit('stateUpdate', worldEngine.getAllPlayers());
});

worldEngine.events.on('chat', (entry) => {
  const payload = `event: chat\ndata: ${JSON.stringify(entry)}\n\n`;
  sseClients.forEach(c => c.res.write(payload));
});

worldEngine.events.on('interaction', (entry) => {
  const payload = `event: interaction\ndata: ${JSON.stringify(entry)}\n\n`;
  sseClients.forEach(c => c.res.write(payload));
});

worldEngine.events.on('activity', (data) => {
  const payload = `event: activity\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => c.res.write(payload));
});

// ── 保留 Socket.IO 通道，供观察链路消费状态更新与基础初始化信息 ───────────────
io.on('connection', (socket) => {
  console.log('🔗 玩家连接:', socket.id);
  socket.emit('characterList', worldEngine.getCharacterList());
});

// ── 健康检查与运行时诊断 ──────────────────────────────────────────────────────
app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    version: require('../package.json').version,
    uptime: Math.floor(process.uptime()),
    mapLoaded: worldEngine.getWorldMap() !== null,
    playerCount: Object.keys(worldEngine.getAllPlayers()).length,
    sseClients: sseClients.length,
  });
});

server.listen(PORT, () => console.log(`🌍 Underworld 已启动: http://localhost:${PORT}`));
