// mcp-bridge.js
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { io } = require('socket.io-client');
const express = require('express');

const myName = process.env.BOT_NAME || 'Alice';
const serverUrl = process.env.SERVER_URL || 'http://localhost:5660';
const socket = io(serverUrl);

let myState = null;
let allPlayers = {};
let townDirectory =[]; // 小镇名录
let characterList = []; // 可选角色列表
let hasJoined = false; // 是否已加入游戏

socket.on('connect', () => {
  resetWatchdog();
  console.error(`📡 成功连接到游戏服务器!`);
  // Don't auto-join — wait for AI to choose character first
  // But if BOT_SPRITE is set, auto-join with that sprite
  const autoSprite = process.env.BOT_SPRITE;
  if (autoSprite) {
    socket.emit('join', { name: myName, sprite: autoSprite });
    hasJoined = true;
  }
});

socket.on('characterList', (list) => {
  resetWatchdog();
  characterList = list;
  console.error(`🎭 收到角色列表: ${list.join(', ')}`);
});

socket.on('stateUpdate', (players) => {
  resetWatchdog();
  allPlayers = players;
  myState = players[socket.id];
});

socket.on('mapDirectory', (dir) => {
  resetWatchdog();
  townDirectory = dir; 
});

// ==========================================
// 🐶 看门狗 (Watchdog) 逻辑
// ==========================================
let heartbeatTimeout = null;
const TIMEOUT_LIMIT = 300000; // 300秒无响应则自杀

function resetWatchdog() {
  if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
  
  // 如果 300 秒内没有触发 resetWatchdog，执行自杀
  heartbeatTimeout = setTimeout(() => {
    console.error("💀 [系统提示] 检测到与服务器连接超时，正在执行自我清理并退出...");
    gracefulExit();
  }, TIMEOUT_LIMIT);
}

// ==== MCP 工具定义 ====
async function listToolsHandler() {
  return {
    tools:[
      { name: 'walk', description: '在小镇移动 (N北/S南/W西/E东)', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum:['N', 'S', 'W', 'E'] }, steps: { type: 'number' } }, required:['direction', 'steps'] } },
      { name: 'say', description: '在小镇里说话', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'look_around', description: '环顾四周，看看当前位置、环境和附近的人', inputSchema: { type: 'object', properties: {} } },
      { name: 'read_map_directory', description: '查看小镇的完整地图名录与重要建筑的坐标', inputSchema: { type: 'object', properties: {} } },
      { name: 'interact', description: '与当前所在区域互动（吃饭、休息、购物、训练、钓鱼等），会根据你所在的地点产生不同的故事结果', inputSchema: { type: 'object', properties: {} } },
      { name: 'list_characters', description: '查看所有可选的角色形象列表。在加入游戏前先看看有哪些角色可以选择', inputSchema: { type: 'object', properties: {} } },
      { name: 'choose_character', description: '选择一个角色形象并加入小镇（或在加入后更换形象）。必须先用 list_characters 查看可选角色', inputSchema: { type: 'object', properties: { sprite: { type: 'string', description: '角色名称，从 list_characters 中选取' } }, required: ['sprite'] } }
    ]
  };
}

async function callToolHandler(request) {
  const { name, arguments: args } = request.params;

  // Set thinking state before tool execution
  socket.emit('playerStateUpdate', { isThinking: true });

  try {
    if (name === 'walk') {
      socket.emit('move', { direction: args.direction, steps: args.steps });
      return { content:[{ type: 'text', text: `你试图向 ${args.direction} 走 ${args.steps} 步。请用 look_around 确认是否到达，或是否撞墙。` }] };
    }

    if (name === 'say') {
      socket.emit('say', args.text);
      return { content:[{ type: 'text', text: `你说: ${args.text}` }] };
    }

    if (name === 'look_around') {
      if (!myState) return { content:[{ type: 'text', text: '你还没进入小镇。' }] };

      let info = `📍 【位置感知】\n你当前坐标: (${myState.x}, ${myState.y})\n`;
      if (myState.currentZoneName === "小镇街道") {
         info += `你目前身处: 【小镇街道】\n环境描述: 空旷的街道\n\n`;
      } else {
         info += `你目前位于或临近: 【${myState.currentZoneName}】\n环境描述: ${myState.currentZoneDesc}\n\n`;
      }

      const others = Object.values(allPlayers).filter(p => p.id !== socket.id && p.name !== 'Observer');
      if (others.length === 0) {
        info += '四周空无一人。';
      } else {
        info += '👥 【附近的人】\n';
        others.forEach(p => {
          const dist = Math.abs(p.x - myState.x) + Math.abs(p.y - myState.y);
          if (dist <= 10) {
             info += `- ${p.name} 距离你 ${dist} 步 (位于 ${p.currentZoneName})`;
             if (p.message) info += `，他正在说: "${p.message}"`;
             info += '\n';
          }
        });
      }

      return { content:[{ type: 'text', text: info }] };
    }

    if (name === 'read_map_directory') {
      if (townDirectory.length === 0) return { content:[{ type: 'text', text: '小镇目前没有任何标记的特殊区域。' }] };
      let info = "📜 【旅游指南】以下是小镇中所有重要地点及其中心坐标：\n\n";
      townDirectory.forEach(place => {
        info += `🔹 [${place.name}] -> 坐标: (${place.x}, ${place.y})\n   说明: ${place.description}\n`;
      });
      info += "\n💡 提示: 使用 walk 工具前往你想去的地方。";
      return { content:[{ type: 'text', text: info }] };
    }

    if (name === 'list_characters') {
      if (characterList.length === 0) {
        return { content:[{ type: 'text', text: '暂时没有收到角色列表，请稍后再试。' }] };
      }
      let info = '🎭 【可选角色】\n';
      characterList.forEach((c, i) => {
        info += `${i + 1}. ${c}\n`;
      });
      info += `\n💡 使用 choose_character 工具选择一个角色加入小镇。`;
      if (hasJoined) info += `\n（你已经在小镇中，选择新角色会更换你的形象。）`;
      return { content:[{ type: 'text', text: info }] };
    }

    if (name === 'choose_character') {
      const sprite = args.sprite;
      if (!characterList.includes(sprite)) {
        return { content:[{ type: 'text', text: `无效角色「${sprite}」。请先用 list_characters 查看可选角色。` }] };
      }

      if (!hasJoined) {
        // First time joining — emit join with chosen sprite
        socket.emit('join', { name: myName, sprite });
        hasJoined = true;
        return { content:[{ type: 'text', text: `你选择了角色「${sprite}」并加入了小镇！欢迎来到这个世界。请用 look_around 查看周围环境。` }] };
      } else {
        // Already joined — change character via chooseCharacter with ack
        const result = await new Promise((resolve) => {
          socket.emit('chooseCharacter', sprite, (response) => {
            resolve(response);
          });
          setTimeout(() => resolve({ success: false, message: '更换角色超时，请重试。' }), 5000);
        });
        if (!result.success) {
          return { content:[{ type: 'text', text: result.message || '更换角色失败。' }] };
        }
        return { content:[{ type: 'text', text: `你已更换角色形象为「${sprite}」！` }] };
      }
    }

    if (name === 'interact') {
      // Clear thinking state immediately so the interaction bubble can render
      socket.emit('playerStateUpdate', { isThinking: false });

      // Use socket.io acknowledgement to get interaction result from server
      const result = await new Promise((resolve) => {
        socket.emit('interact', (response) => {
          resolve(response);
        });
        // Timeout fallback
        setTimeout(() => resolve({ success: false, result: '互动超时，请重试。' }), 5000);
      });

      if (!result.success) {
        return { content:[{ type: 'text', text: result.result || '互动失败。' }] };
      }

      let info = `🎭 【互动】\n📍 地点: ${result.zone}\n🎬 行动: ${result.action}\n\n📖 ${result.result}`;
      return { content:[{ type: 'text', text: info }] };
    }
  } finally {
    // Always reset thinking state after tool execution completes
    socket.emit('playerStateUpdate', { isThinking: false });
  }
}

// ==== 启动模式选择 ====
const useStdio = !process.argv.includes('--http');

if (useStdio) {
  // stdio 模式（Claude Desktop、Cursor 等）
  async function startStdio() {
    const server = new Server({ name: 'alicization-bridge', version: '0.3.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
    server.setRequestHandler(CallToolRequestSchema, callToolHandler);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('🚀 MCP Bridge (stdio) 已启动，AI 灵魂翻译机在线...');
  }
  startStdio();
} else {
  // SSE HTTP 模式（OpenClaw、mcporter 等）
  const MCP_PORT = process.env.MCP_PORT || 3100;
  const httpApp = express();

  const transports = {};

  httpApp.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/message', res);
    transports[transport.sessionId] = transport;

    res.on('close', () => {
      delete transports[transport.sessionId];
    });

    const server = new Server({ name: 'alicization-bridge', version: '0.3.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
    server.setRequestHandler(CallToolRequestSchema, callToolHandler);
    await server.connect(transport);
  });

  httpApp.post('/message', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports[sessionId];
    if (!transport) {
      res.status(400).json({ error: 'Invalid session' });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  httpApp.listen(MCP_PORT, () => {
    console.error(`🚀 MCP Bridge (SSE) 已启动: http://localhost:${MCP_PORT}`);
    console.error(`   SSE 端点: http://localhost:${MCP_PORT}/sse`);
    console.error(`   POST 端点: http://localhost:${MCP_PORT}/message`);
  });
}

// 监听程序的退出信号
function gracefulExit() {
  console.error("👋 正在离开小镇...");
  if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
  if (socket) socket.disconnect();
  process.exit(0);
}

process.on('SIGINT', gracefulExit);  // 监听 Ctrl+C
process.on('SIGTERM', gracefulExit); // 监听系统终止
process.on('exit', () => console.error("🛑 [系统提示] 进程已完全终止。"));