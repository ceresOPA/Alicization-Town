const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BRIDGE_BIN = path.join(__dirname, '..', 'bin', 'bridge.js');
const MOCK_PORT = 59999;

function createPublicKeyFromX(x) {
  return crypto.createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x } });
}

function createMockServer() {
  const profiles = new Map();
  const tokens = new Map();
  const activeTokens = new Map();
  let sequence = 2000n;

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = body ? JSON.parse(body) : {};
        const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') || null;
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/api/characters' && req.method === 'GET') {
          res.end(JSON.stringify({ characters: ['Boy', 'Samurai', 'Princess'] }));
          return;
        }

        if (req.url === '/api/profiles/create' && req.method === 'POST') {
          const id = String(sequence++);
          const handle = `at_${id}`;
          profiles.set(handle, { id, handle, name: payload.name, sprite: payload.sprite, publicKey: payload.publicKey });
          res.end(JSON.stringify({ handle, name: payload.name, sprite: payload.sprite }));
          return;
        }

        if (req.url === '/api/login' && req.method === 'POST') {
          const profile = profiles.get(payload.handle);
          if (!profile) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'profile missing' }));
            return;
          }

          const isValid = crypto.verify(
            null,
            Buffer.from(`alicization-town:login:${payload.handle}:${payload.timestamp}`, 'utf8'),
            createPublicKeyFromX(profile.publicKey),
            Buffer.from(payload.signature, 'base64url'),
          );

          if (!isValid) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'bad signature' }));
            return;
          }

          const previousToken = activeTokens.get(profile.id);
          if (previousToken) tokens.delete(previousToken);

          const token = `token-${profile.id}-${Date.now()}`;
          tokens.set(token, { id: profile.id, name: profile.name, sprite: profile.sprite });
          activeTokens.set(profile.id, token);
          res.end(JSON.stringify({
            status: previousToken ? 'took_over_session' : 'authenticated',
            handle: profile.handle,
            name: profile.name,
            sprite: profile.sprite,
            token,
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            lease_expires_at: new Date(Date.now() + 180000).toISOString(),
            message: previousToken ? `已接管角色 ${profile.name} 的在线会话。` : `已登录角色 ${profile.name}。`,
          }));
          return;
        }

        if (req.url === '/api/session/heartbeat' && req.method === 'POST') {
          if (!auth || !tokens.has(auth)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          res.end(JSON.stringify({
            ok: true,
            lease_expires_at: new Date(Date.now() + 180000).toISOString(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          }));
          return;
        }

        if (req.url === '/api/map' && req.method === 'GET') {
          if (!auth || !tokens.has(auth)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          res.end(JSON.stringify({ directory: [{ name: 'Town Center', x: 5, y: 5, description: 'Central square' }] }));
          return;
        }

        if (req.url === '/api/look' && req.method === 'GET') {
          if (!auth || !tokens.has(auth)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          res.end(JSON.stringify({
            player: { x: 5, y: 5, zone: 'Town Center', zoneDesc: 'Central square' },
            nearby: [],
          }));
          return;
        }

        if (req.url === '/api/walk' && req.method === 'POST') {
          if (!auth || !tokens.has(auth)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          res.end(JSON.stringify({
            player: { x: 8, y: 5, zone: 'Town Center', zoneDesc: 'Central square' },
            pathLength: 3,
            arrived: true,
            wasBlocked: false,
            targetZone: 'Town Center',
          }));
          return;
        }

        if (req.url === '/api/chat' && req.method === 'POST') {
          if (!auth || !tokens.has(auth)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          res.end(JSON.stringify({ ok: true, perceptions: [] }));
          return;
        }

        if (req.url.startsWith('/api/chat') && req.method === 'GET') {
          if (!auth || !tokens.has(auth)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          res.end(JSON.stringify({
            messages: [{ id: 1, time: Date.now(), name: 'BridgeBot', message: '你好' }],
            cursor: `${Date.now()}:1`,
          }));
          return;
        }

        if (req.url === '/api/interact' && req.method === 'POST') {
          if (!auth || !tokens.has(auth)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          res.end(JSON.stringify({ zone: 'Town Center', action: '和居民交谈', result: '你和居民交换了情报。' }));
          return;
        }

        if (req.url === '/api/status' && req.method === 'PUT') {
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.url === '/api/logout' && req.method === 'POST') {
          if (auth) tokens.delete(auth);
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });

    server.listen(MOCK_PORT, () => resolve(server));
  });
}

function sendMCPRequest(proc, request) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`MCP response timeout for ${request.method} (id:${request.id})`)), 10000);
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === request.id) {
            clearTimeout(timeout);
            proc.stdout.removeListener('data', onData);
            resolve(parsed);
            return;
          }
        } catch {}
      }
    };
    proc.stdout.on('data', onData);
    proc.stdin.write(JSON.stringify(request) + '\n');
  });
}

function waitForBridge(proc) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Bridge startup timeout. stderr: ${stderr}`)), 8000);
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes('MCP Bridge')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Bridge exited early (code ${code}). stderr: ${stderr}`));
    });
  });
}

async function initializeBridge(proc) {
  const initResponse = await sendMCPRequest(proc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '1.0.0' },
    },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return initResponse;
}

async function callTool(proc, id, name, args = {}) {
  const response = await sendMCPRequest(proc, {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  return response.result.content[0].text;
}

describe('Bridge MCP (smoke)', () => {
  let mockServer;
  let bridge;
  let tempHome;

  after(() => {
    bridge?.kill('SIGTERM');
    mockServer?.close();
    if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('lists the canonical tools and executes the new login flow', async () => {
    mockServer = await createMockServer();
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'alicization-town-bridge-'));
    bridge = spawn('node', [BRIDGE_BIN], {
      env: {
        ...process.env,
        SERVER_URL: `http://127.0.0.1:${MOCK_PORT}`,
        ALICIZATION_TOWN_HOME: tempHome,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await waitForBridge(bridge);
    const initResponse = await initializeBridge(bridge);
    assert.equal(initResponse.result.serverInfo.name, 'alicization-bridge');
    assert.equal(initResponse.result.serverInfo.version, '0.5.0');

    const listResponse = await sendMCPRequest(bridge, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = listResponse.result.tools;
    const expectedTools = ['login', 'list-profile', 'logout', 'characters', 'look', 'map', 'walk', 'chat', 'interact'];
    assert.deepEqual(tools.map((tool) => tool.name).sort(), expectedTools.slice().sort());

    const loginText = await callTool(bridge, 3, 'login', { create: true, name: 'BridgeBot', sprite: 'Samurai' });
    const loginResult = JSON.parse(loginText);
    assert.equal(loginResult.status, 'created_and_authenticated');
    assert.match(loginResult.handle, /^at_\d+$/);
    assert.equal(loginResult.profile, 'BridgeBot');

    const listText = await callTool(bridge, 4, 'list-profile');
    const profiles = JSON.parse(listText);
    assert.equal(profiles.status, 'ok');
    assert.equal(profiles.default_profile, loginResult.profile);
    assert.equal(profiles.items[0].profile, loginResult.profile);
    assert.equal(profiles.items[0].handle, loginResult.handle);

    assert.match(await callTool(bridge, 5, 'characters'), /Samurai/);
    assert.match(await callTool(bridge, 6, 'map'), /Town Center/);
    assert.match(await callTool(bridge, 7, 'look'), /位置感知/);
    assert.match(await callTool(bridge, 8, 'walk', { forward: 3 }), /已到达/);
    assert.match(await callTool(bridge, 9, 'chat', { text: '你好' }), /你说: 你好/);
    assert.match(await callTool(bridge, 10, 'chat'), /聊天频道/);
    assert.match(await callTool(bridge, 11, 'interact'), /互动/);
    assert.equal(JSON.parse(await callTool(bridge, 12, 'logout')).ok, true);
  });
});
