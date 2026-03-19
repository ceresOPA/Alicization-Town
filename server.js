// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 5660;
app.use(express.json());
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

// 🧠 精准区域判定算法 (支持"临近感知 / 边缘距离计算")
function getZoneAt(gridX, gridY) {
  if (semanticZones.length === 0) return null;

  // 玩家所在格子的正中心像素坐标
  const pixelX = (gridX * worldMap.tilewidth) + (worldMap.tilewidth / 2);
  const pixelY = (gridY * worldMap.tileheight) + (worldMap.tileheight / 2);

  // 💥 魔法变量：感知边缘 (Margin)。允许玩家站在建筑物外围 1.5 个格子的距离内被判定为"身处该区域"
  const INTERACT_MARGIN = worldMap.tilewidth * 1.5;

  let closestZone = null;
  let minDistance = Infinity;

  for (let zone of semanticZones) {
    // 算法：计算一个"点"到一个"矩形(AABB)"的最短几何距离
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

  // Send chat history
  const historyData = `event: chatHistory\ndata: ${JSON.stringify(chatHistory)}\n\n`;
  res.write(historyData);

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
// 🎭 Zone Interaction System
// ==========================================
const ZONE_INTERACTIONS = {
  'building': {
    'restaurant': [
      { action: '点了一碗兰州牛肉拉面', result: '热腾腾的面条端上来了，牛肉鲜嫩，汤头浓郁。你感到精力充沛！(You ordered Lanzhou beef noodles. The steaming noodles arrived - tender beef, rich broth. You feel energized!)' },
      { action: '点了一碗重庆小面', result: '辣得过瘾！麻辣鲜香在口中爆炸，额头冒出细汗。(Chongqing noodles! The spicy flavor explodes in your mouth. Sweat beads on your forehead.)' },
      { action: '和老板聊了几句', result: '老板说最近有冒险者从东边的森林回来，带回了奇怪的消息。(The owner mentions adventurers returned from the eastern forest with strange news.)' },
    ],
    'inn': [
      { action: '在壁炉旁休息', result: '温暖的火焰让你放松下来，恢复了体力。你听到其他旅客在低声交谈。(The warm fireplace relaxes you. You overhear other travelers whispering.)' },
      { action: '向旅馆老板打听消息', result: '老板说："最近小镇来了不少新面孔，练习场那边很热闹。"(The innkeeper says: "Many new faces in town lately. The practice ground has been busy.")' },
      { action: '翻看留言簿', result: '留言簿上有很多冒险者的留言，其中一条写着："池塘深处似乎藏着什么秘密..."(The guestbook has adventurer notes. One reads: "Something seems hidden in the depths of the pond...")' },
    ],
    'weapon': [
      { action: '浏览武器架', result: '你看到了精钢长剑、橡木法杖、短弓和投掷飞刀。店主推荐了一把新到的附魔匕首。(You see steel swords, oak staffs, shortbows and throwing knives. The shopkeeper recommends a newly arrived enchanted dagger.)' },
      { action: '和店主聊天', result: '店主是个退役老兵，他说："好武器要配好技术，去练习场磨练一下吧。"(The retired veteran shopkeeper says: "Good weapons need good skills. Go train at the practice ground.")' },
    ],
    'potion': [
      { action: '查看药水货架', result: '红色恢复药水、蓝色魔力药水、绿色解毒药水，还有一瓶闪着紫光的神秘药剂。(Red healing potions, blue mana potions, green antidotes, and a mysterious purple-glowing elixir.)' },
      { action: '请女巫占卜', result: '女巫凝视水晶球，说道："你的命运与这个小镇紧密相连，重要的相遇即将到来..."(The witch gazes into her crystal ball: "Your fate is tied to this town. An important encounter awaits...")' },
    ],
    'practice': [
      { action: '进行剑术训练', result: '你挥舞木剑练习了基本招式。一个路过的老剑士纠正了你的姿势，你感到技巧有所提升！(You practice basic sword forms with a wooden sword. A passing master corrects your stance - your technique improves!)' },
      { action: '观摩他人比试', result: '两个冒险者正在切磋，剑光闪烁。你从旁观中学到了一些实战技巧。(Two adventurers spar, blades flashing. You pick up combat tips from watching.)' },
      { action: '进行体能训练', result: '跑步、俯卧撑、深蹲...你大汗淋漓，但感觉更强壮了。(Running, push-ups, squats... You are drenched in sweat but feel stronger.)' },
    ],
    'warehouse': [
      { action: '查看库存', result: '仓库里堆满了各种物资：粮食、药草、矿石、木材。管理员正在清点货物。(The warehouse is stocked with supplies: grain, herbs, ore, timber. The manager is taking inventory.)' },
    ],
  },
  'nature': {
    'tree': [
      { action: '在树荫下乘凉', result: '微风吹过树叶，发出沙沙声。你在阴凉处感到十分惬意，注意到树干上刻着一些古老的符文。(A breeze rustles the leaves. You relax in the shade and notice ancient runes carved into the trunk.)' },
      { action: '爬上树瞭望', result: '从高处可以看到整个小镇的全貌。远处的练习场传来金属碰撞声，池塘在阳光下闪闪发光。(From above you see the whole town. Metallic clashes echo from the practice ground. The pond glitters in sunlight.)' },
    ],
    'pond': [
      { action: '观赏池塘里的鱼', result: '几条锦鲤在水中悠然游弋，睡莲的花瓣微微颤动。水面下似乎有什么东西闪了一下光。(Koi swim lazily among trembling lotus petals. Something glints beneath the surface.)' },
      { action: '在池塘边发呆', result: '你静静地坐在池塘边，听着水声和鸟鸣。这是难得的宁静时光。(You sit quietly by the pond, listening to water and birdsong. A rare moment of peace.)' },
      { action: '尝试钓鱼', result: '你找了根树枝当鱼竿。等了一会儿，感到一阵拉扯——钓到了一条小鱼！(You fashion a fishing rod from a branch. After waiting, you feel a tug - you caught a small fish!)' },
    ],
    'grassland': [
      { action: '在草地上躺下', result: '柔软的草地很舒服，你望着天空中飘过的云朵，心情变得轻松愉快。(The soft grass is comfortable. You watch clouds drift by and feel carefree.)' },
    ],
  },
  'floor': {
    'paved': [
      { action: '观察石板路', result: '石板路上留有各种脚印和车辙，可以看出这里是小镇的主要通道。(Footprints and cart tracks show this is a main thoroughfare.)' },
    ],
  },
};

function getInteractionForZone(zone) {
  if (!zone) return { action: '环顾四周', result: '这里是空旷的街道，没有什么特别的。(An open street with nothing remarkable.)' };

  const zoneType = zone.type || 'building';
  const zoneName = (zone.name || '').toLowerCase();

  // Match zone name to interaction category
  let category = null;
  if (zoneName.includes('noodle') || zoneName.includes('restaurant') || zoneName.includes('面馆')) category = 'restaurant';
  else if (zoneName.includes('inn') || zoneName.includes('旅馆')) category = 'inn';
  else if (zoneName.includes('weapon') || zoneName.includes('armor') || zoneName.includes('武器')) category = 'weapon';
  else if (zoneName.includes('potion') || zoneName.includes('magic') || zoneName.includes('药水')) category = 'potion';
  else if (zoneName.includes('practice') || zoneName.includes('练习')) category = 'practice';
  else if (zoneName.includes('warehouse') || zoneName.includes('仓库')) category = 'warehouse';
  else if (zoneName.includes('tree') || zoneName.includes('树')) category = 'tree';
  else if (zoneName.includes('pond') || zoneName.includes('池塘')) category = 'pond';
  else if (zoneName.includes('grass') || zoneName.includes('草')) category = 'grassland';
  else if (zoneName.includes('paved') || zoneName.includes('石板')) category = 'paved';

  const typeInteractions = ZONE_INTERACTIONS[zoneType];
  if (!typeInteractions || !category || !typeInteractions[category]) {
    return { action: '四处看看', result: `你仔细观察了${zone.name}，感受着这里的氛围。(You observe ${zone.name} and take in the atmosphere.)` };
  }

  const options = typeInteractions[category];
  return options[Math.floor(Math.random() * options.length)];
}

// Chat history for the log
const chatHistory = [];
const MAX_CHAT_HISTORY = 50;

// Activity log per player (for the AI panel)
const playerActivities = {}; // keyed by player id => array of recent activities
const MAX_ACTIVITIES_PER_PLAYER = 20;

function addPlayerActivity(playerId, activity) {
  if (!playerActivities[playerId]) playerActivities[playerId] = [];
  playerActivities[playerId].push({ time: Date.now(), ...activity });
  if (playerActivities[playerId].length > MAX_ACTIVITIES_PER_PLAYER) {
    playerActivities[playerId].shift();
  }
  broadcastActivityToWeb(playerId);
}

function broadcastActivityToWeb(playerId) {
  if (sseClients.length === 0) return;
  const player = gameState.players[playerId];
  if (!player) return;
  const data = {
    id: playerId,
    name: player.name,
    sprite: player.sprite,
    activities: playerActivities[playerId] || []
  };
  const dataString = `event: activity\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.res.write(dataString));
}

function addChatHistory(playerName, message) {
  chatHistory.push({
    time: Date.now(),
    name: playerName,
    message: message
  });
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
}

// SSE broadcast chat history
function broadcastChatToWeb(entry) {
  if (sseClients.length === 0) return;
  const dataString = `event: chat\ndata: ${JSON.stringify(entry)}\n\n`;
  sseClients.forEach(client => client.res.write(dataString));
}

// SSE broadcast interaction events
function broadcastInteractionToWeb(entry) {
  if (sseClients.length === 0) return;
  const dataString = `event: interaction\ndata: ${JSON.stringify(entry)}\n\n`;
  sseClients.forEach(client => client.res.write(dataString));
}

// ==========================================
// 🧍 玩家状态管理
// ==========================================
const gameState = { players: {} };

// Character sprite pool for unique appearance per player
const CHARACTER_SPRITES = ['Custom1', 'Boy', 'Cavegirl', 'Eskimo', 'FighterRed', 'Monk', 'OldMan', 'Princess', 'Samurai', 'Skeleton', 'Vampire', 'Villager'];
let nextSpriteIndex = 0;

// ==========================================
// 🎮 核心游戏逻辑 (Socket.IO 和 REST API 共用)
// ==========================================
function updatePlayerZone(player) {
  const zone = getZoneAt(player.x, player.y);
  player.currentZoneName = zone ? zone.name : "小镇街道";
  player.currentZoneDesc = zone ? (zone.properties?.find(p => p.name === 'description')?.value || '') : "空旷的街道";
}

function createPlayer(id, name, chosenSprite) {
  const spawnX = 5, spawnY = 5;

  // Use chosen sprite if valid, otherwise assign round-robin
  let sprite;
  if (chosenSprite && CHARACTER_SPRITES.includes(chosenSprite)) {
    sprite = chosenSprite;
  } else {
    sprite = CHARACTER_SPRITES[nextSpriteIndex % CHARACTER_SPRITES.length];
    nextSpriteIndex++;
  }

  gameState.players[id] = {
    id, name, x: spawnX, y: spawnY, lastDirection: 'S',
    message: '', interactionText: '', isThinking: false,
    sprite: sprite,
    currentZoneName: '', currentZoneDesc: ''
  };
  updatePlayerZone(gameState.players[id]);
  return gameState.players[id];
}

function removePlayer(id) {
  delete gameState.players[id];
  delete playerActivities[id];
  io.emit('stateUpdate', gameState.players);
  broadcastStateToWeb();
}

function movePlayer(player, direction, steps) {
  player.lastDirection = direction;
  const maxSteps = Math.max(1, Math.min(steps || 1, 20));
  const dx = direction === 'E' ? 1 : direction === 'W' ? -1 : 0;
  const dy = direction === 'S' ? 1 : direction === 'N' ? -1 : 0;
  let moved = 0;

  for (let i = 0; i < maxSteps; i++) {
    const nextX = player.x + dx;
    const nextY = player.y + dy;
    if (nextX < 0 || nextX >= worldMap.width || nextY < 0 || nextY >= worldMap.height) break;
    if (collisionMap[nextY * worldMap.width + nextX] === 1) break;
    player.x = nextX;
    player.y = nextY;
    moved++;
  }

  updatePlayerZone(player);
  io.emit('stateUpdate', gameState.players);
  broadcastStateToWeb();
  addPlayerActivity(player.id, { type: 'move', text: `移动到 (${player.x}, ${player.y}) - ${player.currentZoneName}` });
  return { moved, blocked: moved < maxSteps };
}

function playerSay(playerId, text) {
  const player = gameState.players[playerId];
  if (!player) return;
  player.message = text;
  const chatEntry = { time: Date.now(), name: player.name, message: text };
  addChatHistory(chatEntry.name, chatEntry.message);
  broadcastChatToWeb(chatEntry);
  addPlayerActivity(playerId, { type: 'say', text: `说: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"` });
  io.emit('stateUpdate', gameState.players);
  broadcastStateToWeb();
  setTimeout(() => {
    if (gameState.players[playerId]) {
      gameState.players[playerId].message = '';
      io.emit('stateUpdate', gameState.players);
      broadcastStateToWeb();
    }
  }, 5000);
}

function playerInteract(playerId) {
  const player = gameState.players[playerId];
  if (!player) return null;
  const zone = getZoneAt(player.x, player.y);
  const interaction = getInteractionForZone(zone);

  player.interactionText = interaction.action;
  player.interactionIcon = interaction.icon || '';
  player.interactionSound = interaction.sound || 'interact';
  io.emit('stateUpdate', gameState.players);
  broadcastStateToWeb();
  setTimeout(() => {
    if (gameState.players[playerId]) {
      gameState.players[playerId].interactionText = '';
      gameState.players[playerId].interactionIcon = '';
      gameState.players[playerId].interactionSound = '';
      io.emit('stateUpdate', gameState.players);
      broadcastStateToWeb();
    }
  }, 4000);

  const entry = { time: Date.now(), name: player.name, zone: zone ? zone.name : '小镇街道', action: interaction.action, result: interaction.result };
  broadcastInteractionToWeb(entry);
  addPlayerActivity(playerId, { type: 'interact', text: `在${zone ? zone.name : '街道'}: ${interaction.action}` });
  return { zone: entry.zone, action: interaction.action, result: interaction.result };
}

function resolveDestination(destination) {
  const query = destination.toLowerCase();
  const zone = semanticZones.find(z => z.name.toLowerCase().includes(query));
  if (!zone) return null;
  return {
    x: Math.floor((zone.x + zone.width / 2) / worldMap.tilewidth),
    y: Math.floor((zone.y + zone.height / 2) / worldMap.tileheight),
    name: zone.name
  };
}

function navigatePlayer(player, targetX, targetY) {
  const result = findPath(player.x, player.y, targetX, targetY);
  if (!result) return null;
  const { path } = result;
  if (path.length === 0) return { moved: false };

  const startX = player.x, startY = player.y;
  const finalPos = path[path.length - 1];
  player.x = finalPos.x;
  player.y = finalPos.y;
  if (path.length >= 2) {
    const last = path[path.length - 1], prev = path[path.length - 2];
    const dx = last.x - prev.x, dy = last.y - prev.y;
    player.lastDirection = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N';
  }
  updatePlayerZone(player);
  io.emit('stateUpdate', gameState.players);
  broadcastStateToWeb();
  addPlayerActivity(player.id, { type: 'navigate', text: `寻路到 (${player.x}, ${player.y}) - ${player.currentZoneName}` });
  return {
    from: { x: startX, y: startY },
    to: { x: player.x, y: player.y },
    totalSteps: path.length,
    route: compressPath(startX, startY, path),
    zone: player.currentZoneName
  };
}

function getMapDirectory() {
  return semanticZones.map(z => ({
    name: z.name,
    x: Math.floor((z.x + z.width / 2) / worldMap.tilewidth),
    y: Math.floor((z.y + z.height / 2) / worldMap.tileheight),
    description: z.properties?.find(p => p.name === 'description')?.value || ''
  }));
}

// ==========================================
// 🔌 Socket.IO 连接处理
// ==========================================
io.on('connection', (socket) => {
  console.log('🔗 玩家连接:', socket.id);

  // Send available character list immediately on connect
  socket.emit('characterList', CHARACTER_SPRITES);

  socket.on('join', (data) => {
    // Support both old format (string name) and new format ({name, sprite})
    let name, chosenSprite;
    if (typeof data === 'string') {
      name = data;
    } else {
      name = data.name;
      chosenSprite = data.sprite;
    }

    createPlayer(socket.id, name, chosenSprite);
    socket.emit('initMap', worldMap);
    socket.emit('mapDirectory', getMapDirectory());
    io.emit('stateUpdate', gameState.players);
    broadcastStateToWeb();
    addPlayerActivity(socket.id, { type: 'join', text: `加入了小镇 (角色: ${gameState.players[socket.id].sprite})` });
  });

  // Allow character change after joining
  socket.on('chooseCharacter', (spriteName, callback) => {
    const player = gameState.players[socket.id];
    if (!player) {
      if (typeof callback === 'function') callback({ success: false, message: '你还没加入游戏。' });
      return;
    }
    if (!CHARACTER_SPRITES.includes(spriteName)) {
      if (typeof callback === 'function') callback({ success: false, message: `无效角色。可选: ${CHARACTER_SPRITES.join(', ')}` });
      return;
    }
    player.sprite = spriteName;
    io.emit('stateUpdate', gameState.players);
    broadcastStateToWeb();
    if (typeof callback === 'function') callback({ success: true, message: `你选择了角色: ${spriteName}` });
  });

  socket.on('move', (data) => {
    const player = gameState.players[socket.id];
    if (player) movePlayer(player, data.direction, data.steps || 1);
  });

  socket.on('say', (msg) => {
    playerSay(socket.id, msg);
  });

  socket.on('interact', (callback) => {
    const result = playerInteract(socket.id);
    if (typeof callback === 'function') {
      if (result) callback({ success: true, ...result });
      else callback({ success: false, result: '你还没进入小镇。' });
    }
  });

  socket.on('playerStateUpdate', (data) => {
    const player = gameState.players[socket.id];
    if (player) {
      player.isThinking = data.isThinking;
      io.emit('stateUpdate', gameState.players);
    }
    broadcastStateToWeb();
  });

  socket.on('disconnect', () => {
    removePlayer(socket.id);
  });
});

// ==========================================
// 🧭 A* 寻路引擎
// ==========================================
function findNearestWalkable(tx, ty) {
  const W = worldMap.width, H = worldMap.height;
  const visited = new Set();
  const queue = [{ x: tx, y: ty }];
  visited.add(`${tx},${ty}`);
  while (queue.length > 0) {
    const { x, y } = queue.shift();
    if (x >= 0 && x < W && y >= 0 && y < H && collisionMap[y * W + x] !== 1) return { x, y };
    for (const [dx, dy] of [[0,-1],[0,1],[1,0],[-1,0]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!visited.has(k) && nx >= 0 && nx < W && ny >= 0 && ny < H) { visited.add(k); queue.push({ x: nx, y: ny }); }
    }
  }
  return null;
}

function findPath(startX, startY, goalX, goalY) {
  const W = worldMap.width, H = worldMap.height;
  let gx = goalX, gy = goalY;

  if (gx < 0 || gx >= W || gy < 0 || gy >= H || collisionMap[gy * W + gx] === 1) {
    const w = findNearestWalkable(gx, gy);
    if (!w) return null;
    gx = w.x; gy = w.y;
  }
  if (startX === gx && startY === gy) return { path: [], goalX: gx, goalY: gy };

  const idx = (x, y) => y * W + x;
  const open = [{ x: startX, y: startY, g: 0, f: Math.abs(startX - gx) + Math.abs(startY - gy) }];
  const gScores = new Float64Array(W * H).fill(Infinity);
  gScores[idx(startX, startY)] = 0;
  const parent = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);

  while (open.length > 0) {
    let mi = 0;
    for (let i = 1; i < open.length; i++) { if (open[i].f < open[mi].f) mi = i; }
    const cur = open[mi];
    open[mi] = open[open.length - 1]; open.pop();

    const ck = idx(cur.x, cur.y);
    if (closed[ck]) continue;
    closed[ck] = 1;

    if (cur.x === gx && cur.y === gy) {
      const path = [];
      let k = ck;
      while (k !== idx(startX, startY)) { path.push({ x: k % W, y: Math.floor(k / W) }); k = parent[k]; }
      path.reverse();
      return { path, goalX: gx, goalY: gy };
    }

    for (const [dx, dy] of [[0,-1],[0,1],[1,0],[-1,0]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nk = idx(nx, ny);
      if (closed[nk] || collisionMap[nk] === 1) continue;
      const ng = cur.g + 1;
      if (ng < gScores[nk]) {
        gScores[nk] = ng;
        parent[nk] = ck;
        open.push({ x: nx, y: ny, g: ng, f: ng + Math.abs(nx - gx) + Math.abs(ny - gy) });
      }
    }
  }
  return null;
}

function compressPath(startX, startY, path) {
  if (!path || path.length === 0) return [];
  const steps = [];
  let px = startX, py = startY;
  for (const p of path) {
    const dx = p.x - px, dy = p.y - py;
    const dir = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N';
    if (steps.length > 0 && steps[steps.length - 1].direction === dir) steps[steps.length - 1].steps++;
    else steps.push({ direction: dir, steps: 1 });
    px = p.x; py = p.y;
  }
  return steps;
}

// ==========================================
// 🌐 加载 REST API 路由
// ==========================================
require('./rest-api')(app, {
  gameState, io, crypto, CHARACTER_SPRITES,
  createPlayer, removePlayer, movePlayer, playerSay, playerInteract,
  resolveDestination, navigatePlayer, getMapDirectory, getZoneAt, addPlayerActivity
});

server.listen(PORT, '0.0.0.0', () => console.log(`🌍 Underworld 已启动: http://0.0.0.0:${PORT}`));
