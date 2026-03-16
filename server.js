// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 5660;
app.use(express.static('public'));

// ==========================================
// 🗺️ Tiled 地图与物理引擎
// ==========================================
const mapPath = path.join(__dirname, 'public', 'assets', 'map.tmj');
let worldMap = null;
let collisionMap = [];
let semanticZones =[];

if (fs.existsSync(mapPath)) {
  worldMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  collisionMap = new Array(worldMap.width * worldMap.height).fill(0);

  // 1. 物理碰撞层设定 (填入你 Tiled 里不可行走的图层名)
  const collisionLayerNames = ["BaseNature", "Nature", "Building", "BuildingTop"]; 

  worldMap.layers.forEach(layer => {
    if (layer.type === 'tilelayer' && collisionLayerNames.includes(layer.name)) {
      layer.data.forEach((tileId, index) => {
        if (tileId !== 0) collisionMap[index] = 1; // 1 表示有障碍物
      });
    }
  });

  // 2. 提取语义区域 (Semantic Zones)
  const zoneLayer = worldMap.layers.find(l => l.name === 'SemanticZones' || l.type === 'objectgroup');
  if (zoneLayer && zoneLayer.objects) {
    semanticZones = zoneLayer.objects;
    console.log(`🗺️ 成功加载 ${semanticZones.length} 个语义区域！`);
  }
} else {
  console.error("❌ 找不到 map.tmj！");
}

// 🧠 精准区域判定算法 (支持“临近感知 / 边缘距离计算”)
function getZoneAt(gridX, gridY) {
  if (semanticZones.length === 0) return null;
  
  // 玩家所在格子的正中心像素坐标
  const pixelX = (gridX * worldMap.tilewidth) + (worldMap.tilewidth / 2);
  const pixelY = (gridY * worldMap.tileheight) + (worldMap.tileheight / 2);

  // 💥 魔法变量：感知边缘 (Margin)。允许玩家站在建筑物外围 1.5 个格子的距离内被判定为“身处该区域”
  const INTERACT_MARGIN = worldMap.tilewidth * 1.5; 

  let closestZone = null;
  let minDistance = Infinity;

  for (let zone of semanticZones) {
    // 算法：计算一个“点”到一个“矩形(AABB)”的最短几何距离
    // 如果点在矩形内部，dx 和 dy 都会是 0
    const dx = Math.max(zone.x - pixelX, 0, pixelX - (zone.x + zone.width));
    const dy = Math.max(zone.y - pixelY, 0, pixelY - (zone.y + zone.height));
    const distance = Math.sqrt(dx * dx + dy * dy);

    // 如果玩家在感知范围内 (内部，或贴着墙壁)，并且是离得最近的一个区域
    if (distance <= INTERACT_MARGIN && distance < minDistance) {
      minDistance = distance;
      closestZone = zone;
    }
  }
  
  return closestZone;
}

// ==========================================
// 📺 新增：为网页端打造的 SSE 广播站
// ==========================================
let sseClients = []; // 存储所有连接的网页客户端

app.get('/events', (req, res) => {
  // 设置 SSE 头部
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // 立刻发送头部

  // 将这个客户端加入广播列表
  const clientId = Date.now();
  sseClients.push({ id: clientId, res: res });
  console.log(`📺 新的网页观察者已连接 (ID: ${clientId})`);

  // Send initial state immediately so new viewers see current players
  const initData = `data: ${JSON.stringify(gameState.players)}\n\n`;
  res.write(initData);

  // 网页关闭时，从列表中移除
  req.on('close', () => {
    sseClients = sseClients.filter(client => client.id !== clientId);
    console.log(`👋 网页观察者已断开 (ID: ${clientId})`);
  });
});

// 广播函数：将最新状态发送给所有连接的网页
function broadcastStateToWeb() {
  if (sseClients.length === 0) return;
  
  const dataString = `data: ${JSON.stringify(gameState.players)}\n\n`;
  sseClients.forEach(client => client.res.write(dataString));
}

// ==========================================
// 🧍 玩家状态管理
// ==========================================
const gameState = { players: {} };

io.on('connection', (socket) => {
  console.log('🔗 玩家连接:', socket.id);

  socket.on('join', (name) => {
    let spawnX = 5, spawnY = 5; // 默认坐标
    const zone = getZoneAt(spawnX, spawnY);
    
    gameState.players[socket.id] = {
      id: socket.id, name: name, x: spawnX, y: spawnY, lastDirection: 'S', message: '', isThinking: false,
      currentZoneName: zone ? zone.name : "小镇街道",
      currentZoneDesc: zone ? (zone.properties?.find(p => p.name === 'description')?.value || '') : "空旷的街道"
    };
    
    // 整理一份“地图旅游指南”发给 MCP 网关
    const directory = semanticZones.map(z => ({
      name: z.name,
      // 把原始像素坐标换算成 AI 用的网格中心坐标
      x: Math.floor((z.x + z.width/2) / worldMap.tilewidth),
      y: Math.floor((z.y + z.height/2) / worldMap.tileheight),
      description: z.properties?.find(p => p.name === 'description')?.value || ''
    }));

    socket.emit('initMap', worldMap);
    socket.emit('mapDirectory', directory);
    io.emit('stateUpdate', gameState.players);
  });

  socket.on('move', (data) => {
    const player = gameState.players[socket.id];
    if (!player) return;

    player.lastDirection = data.direction;
    const steps = Math.max(1, Math.min(data.steps, 20)); // Clamp steps to prevent abuse

    // Step-by-step collision: walk each tile along the path, stop at first obstacle
    const dx = data.direction === 'E' ? 1 : data.direction === 'W' ? -1 : 0;
    const dy = data.direction === 'S' ? 1 : data.direction === 'N' ? -1 : 0;

    for (let i = 0; i < steps; i++) {
      const nextX = player.x + dx;
      const nextY = player.y + dy;

      // Bounds check
      if (nextX < 0 || nextX >= worldMap.width || nextY < 0 || nextY >= worldMap.height) break;

      // Collision check per tile
      if (collisionMap[nextY * worldMap.width + nextX] === 1) break;

      player.x = nextX;
      player.y = nextY;
    }

    // Update semantic zone
    const zone = getZoneAt(player.x, player.y);
    player.currentZoneName = zone ? zone.name : "小镇街道";
    player.currentZoneDesc = zone ? (zone.properties?.find(p => p.name === 'description')?.value || '') : "空旷的街道";

    io.emit('stateUpdate', gameState.players);
    broadcastStateToWeb(); // Bug fix: broadcast move events to SSE web viewers
  });

  socket.on('say', (msg) => {
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].message = msg;
      io.emit('stateUpdate', gameState.players);
      setTimeout(() => {
        if (gameState.players[socket.id]) {
          gameState.players[socket.id].message = '';
          io.emit('stateUpdate', gameState.players);
        }
      }, 5000);
    }
  broadcastStateToWeb();
  });

  socket.on('playerStateUpdate', (data) => {
    const player = gameState.players[socket.id];
    if (player) {
      // 把状态更新到玩家对象上
      player.isThinking = data.isThinking;
      
      // 广播给所有观察者
      io.emit('stateUpdate', gameState.players);
    }
    broadcastStateToWeb();
  });

  socket.on('disconnect', () => {
    delete gameState.players[socket.id];
    io.emit('stateUpdate', gameState.players);
    broadcastStateToWeb();
  });
});

server.listen(PORT, () => console.log(`🌍 Underworld 已启动: http://localhost:${PORT}`));