// MCP 服务入口，负责把工具调用转交给共享客户端能力层
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const client = require('./client');

const toolModules = [
  require('./tools/character'),
  require('./tools/navigation'),
  require('./tools/movement'),
  require('./tools/communication'),
  require('./tools/interaction'),
];

const allDefinitions = toolModules.flatMap((module) => module.definitions);

const mcpServer = new Server(
  { name: 'alicization-bridge', version: '0.5.0' },
  { capabilities: { tools: {} } },
);

async function injectRelevantMemories(result) {
  if (!result?.memoryContext) return result;
  const memoryContext = result.memoryContext;
  delete result.memoryContext;
  if (result.content?.[0]?.type !== 'text') return result;
  try {
    const { auth, result: memories } = await client.recallMemories(memoryContext);
    if (!auth && memories && memories.length > 0) {
      result.content[0].text = client.appendMemorySection(result.content[0].text, memories);
    }
  } catch {}
  return result;
}

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allDefinitions }));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const shouldReflectThinking = ['look', 'map', 'walk', 'say', 'interact'].includes(name);
  if (shouldReflectThinking) {
    await client.setThinking(true).catch(() => {});
  }

  try {
    for (const module of toolModules) {
      const result = await module.handle(name, args || {}, client);
      if (result) return injectRelevantMemories(result);
    }
    return { content: [{ type: 'text', text: `未知工具: ${name}` }] };
  } finally {
    if (shouldReflectThinking) {
      await client.setThinking(false).catch(() => {});
    }
  }
});

async function start() {
  await client.connect();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('🚀 MCP Bridge 已启动，新的短名工具面已上线...');
}

function gracefulExit() {
  client.disconnect().finally(() => process.exit(0));
}

process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);

start();
