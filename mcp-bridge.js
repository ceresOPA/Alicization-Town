// mcp-bridge.js
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { io } = require('socket.io-client');

const myName = process.env.BOT_NAME || 'Alice';
const serverUrl = process.env.SERVER_URL || 'http://localhost:5660';
const socket = io(serverUrl);

let myState = null;
let allPlayers = {};
let townDirectory =[]; // 小镇名录

socket.on('connect', () => {
  resetWatchdog();
  console.error(`📡 成功连接到游戏服务器!`);
  socket.emit('join', myName);
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
const TIMEOUT_LIMIT = 30000; // 30秒无响应则自杀

function resetWatchdog() {
  if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
  
  // 如果 30 秒内没有触发 resetWatchdog，执行自杀
  heartbeatTimeout = setTimeout(() => {
    console.error("💀 [系统提示] 检测到与服务器连接超时，正在执行自我清理并退出...");
    gracefulExit();
  }, TIMEOUT_LIMIT);
}

// ==== MCP 服务器设置 ====
const mcpServer = new Server({ name: 'alicization-bridge', version: '0.3.0' }, { capabilities: { tools: {} } });

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools:[
      { name: 'walk', description: '在小镇移动 (N北/S南/W西/E东)', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum:['N', 'S', 'W', 'E'] }, steps: { type: 'number' } }, required:['direction', 'steps'] } },
      { name: 'say', description: '在小镇里说话', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'look_around', description: '环顾四周，看看当前位置、环境和附近的人', inputSchema: { type: 'object', properties: {} } },
      { name: 'read_map_directory', description: '查看小镇的完整地图名录与重要建筑的坐标', inputSchema: { type: 'object', properties: {} } }
    ]
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
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
  } finally {
    // Always reset thinking state after tool execution completes
    socket.emit('playerStateUpdate', { isThinking: false });
  }
});

async function start() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('🚀 MCP Bridge 已启动，AI 灵魂翻译机在线...');
}
start();

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