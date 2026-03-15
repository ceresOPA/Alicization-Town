// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
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
    let newX = player.x, newY = player.y;
    if (data.direction === 'N') newY -= data.steps;
    if (data.direction === 'S') newY += data.steps;
    if (data.direction === 'W') newX -= data.steps;
    if (data.direction === 'E') newX += data.steps;

    newX = Math.max(0, Math.min(worldMap.width - 1, newX));
    newY = Math.max(0, Math.min(worldMap.height - 1, newY));

    // 碰撞检测
    if (collisionMap[newY * worldMap.width + newX] !== 1) {
      player.x = newX;
      player.y = newY;
      
      // 更新玩家所在的语义区域
      const zone = getZoneAt(player.x, player.y);
      player.currentZoneName = zone ? zone.name : "小镇街道";
      player.currentZoneDesc = zone ? (zone.properties?.find(p => p.name === 'description')?.value || '') : "空旷的街道";
    }

    io.emit('stateUpdate', gameState.players);
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
  });

  socket.on('playerStateUpdate', (data) => {
    const player = gameState.players[socket.id];
    if (player) {
      // 把状态更新到玩家对象上
      player.isThinking = data.isThinking;
      
      // 广播给所有观察者
      io.emit('stateUpdate', gameState.players);
    }
  });

  socket.on('disconnect', () => {
    delete gameState.players[socket.id];
    io.emit('stateUpdate', gameState.players);
  });
});

server.listen(5660, () => console.log(`🌍 Underworld 已启动: http://localhost:5660`));