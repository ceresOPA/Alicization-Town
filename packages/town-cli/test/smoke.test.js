const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const CLI_ENTRY = path.join(__dirname, '..', 'src', 'town.js');
const MOCK_PORT = 59998;
const execFileAsync = promisify(execFile);

function createPublicKeyFromX(x) {
  return crypto.createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x } });
}

function createMockServer() {
  const profiles = new Map();
  const tokens = new Map();
  const activeTokens = new Map();
  const state = {
    lookMode: 'busy',
    recallRequests: [],
  };
  let sequence = 1000n;

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
          res.end(JSON.stringify({ directory: [{ id: 'town_center#0001', name: 'Town Center', navigable: true, x: 5, y: 5, description: 'Central square' }] }));
          return;
        }

        if (req.url === '/api/look' && req.method === 'GET') {
          if (!auth || !tokens.has(auth)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          const session = tokens.get(auth);
          if (state.lookMode === 'eligible') {
            res.end(JSON.stringify({
              player: { x: 5, y: 5, zone: 'Town Center', zoneDesc: 'Central square', sprite: session.sprite, name: session.name },
              nearby: [{ id: 'npc-alice', name: 'Alice', distance: 2, relativeDirection: '左侧', zone: 'Town Center', message: null }],
            }));
            return;
          }
          res.end(JSON.stringify({
            player: { x: 5, y: 5, zone: 'Town Center', zoneDesc: 'Central square', sprite: session.sprite, name: session.name },
            nearby: [{ name: 'Alice', distance: 2, relativeDirection: '左侧', zone: 'Town Center', message: 'hello' }],
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
            player: { x: 7, y: 5, zone: 'Town Center', zoneDesc: 'Central square' },
            pathLength: 2,
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
          res.end(JSON.stringify({ ok: true }));
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

        if (req.url === '/api/memories/recall' && req.method === 'POST') {
          if (!auth || !tokens.has(auth)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          state.recallRequests.push(payload);
          const memories = payload.location === 'Town Center'
            ? [{ id: 'cli-town', content: 'You recently coordinated with someone in Town Center.' }]
            : [{ id: 'cli-general', content: 'You remember the town rewards revisiting important places.' }];
          res.end(JSON.stringify({ memories: memories.slice(0, payload.limit || memories.length) }));
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

    server.testState = state;
    server.listen(MOCK_PORT, () => resolve(server));
  });
}

async function runCli(args, extraEnv = {}) {
  return execFileAsync('node', [CLI_ENTRY, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SERVER_URL: `http://127.0.0.1:${MOCK_PORT}`,
      ...extraEnv,
    },
  });
}

describe('Town CLI (smoke)', () => {
  let mockServer;
  let tempHome;
  let env;

  before(async () => {
    mockServer = await createMockServer();
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'alicization-town-cli-'));
    env = {
      ALICIZATION_TOWN_HOME: tempHome,
      HOME: tempHome,
      USERPROFILE: tempHome,
    };
  });

  after(() => {
    mockServer?.close();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('creates a profile, logs in, and executes the canonical commands', async () => {
    const empty = await runCli(['list-profile'], env);
    const emptyResult = JSON.parse(empty.stdout);
    assert.equal(emptyResult.status, 'empty');

    const login = await runCli(['login', '--create', '--name', 'SmokeBot', '--sprite', 'Samurai'], env);
    const loginResult = JSON.parse(login.stdout);
    assert.equal(loginResult.status, 'created_and_authenticated');
    assert.match(loginResult.handle, /^at_\d+$/);
    assert.equal(loginResult.profile, 'SmokeBot');

    const listed = await runCli(['list-profile'], env);
    const listResult = JSON.parse(listed.stdout);
    assert.equal(listResult.status, 'ok');
    assert.equal(listResult.default_profile, loginResult.profile);
    assert.equal(listResult.items[0].profile, loginResult.profile);
    assert.equal(listResult.items[0].handle, loginResult.handle);
    assert.equal(listResult.items[0].is_ready, true);

    const characters = await runCli(['characters'], env);
    assert.match(characters.stdout, /Samurai/);

    const map = await runCli(['map'], env);
    assert.match(map.stdout, /Town Center/);
    assert.doesNotMatch(map.stdout, /Relevant memories/);
    assert.equal(mockServer.testState.recallRequests.length, 0);

    const look = await runCli(['look'], env);
    assert.match(look.stdout, /位置感知/);
    assert.match(look.stdout, /Alice/);
    assert.match(look.stdout, /左侧/);
    assert.doesNotMatch(look.stdout, /Relevant memories/);
    assert.equal(mockServer.testState.recallRequests.length, 0);

    mockServer.testState.lookMode = 'eligible';
    const eligibleLook = await runCli(['look'], env);
    assert.match(eligibleLook.stdout, /Relevant memories/);
    assert.equal(mockServer.testState.recallRequests.length, 1);
    assert.deepEqual(mockServer.testState.recallRequests[0], {
      partnerId: 'npc-alice',
      location: 'Town Center',
      limit: 2,
    });

    const walk = await runCli(['walk', '--to', 'town_center#0001'], env);
    assert.match(walk.stdout, /已到达/);

    const chatResult = await runCli(['chat', '--text', '你好'], env);
    assert.match(chatResult.stdout, /你说: 你好/);

    const interact = await runCli(['interact'], env);
    assert.match(interact.stdout, /Relevant memories/);
    assert.match(interact.stdout, /互动/);
    assert.equal(mockServer.testState.recallRequests.length, 2);
    assert.deepEqual(mockServer.testState.recallRequests[1], {
      location: 'Town Center',
      limit: 2,
    });

    const logout = await runCli(['logout'], env);
    assert.equal(JSON.parse(logout.stdout).ok, true);

    const relogin = await runCli(['login', '--profile', loginResult.profile], env);
    const reloginResult = JSON.parse(relogin.stdout);
    assert.equal(reloginResult.profile, loginResult.profile);
    assert.equal(reloginResult.handle, loginResult.handle);
  });

  it('supports multiple local profiles and explicit profile switching', async () => {
    const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'alicization-town-cli-multi-'));
    const isolatedEnv = {
      ALICIZATION_TOWN_HOME: isolatedHome,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
    };

    try {
      const first = JSON.parse((await runCli(['login', '--create', '--name', 'AlphaBot', '--sprite', 'Boy'], isolatedEnv)).stdout);
      const second = JSON.parse((await runCli(['login', '--create', '--name', 'BetaBot', '--sprite', 'Princess'], isolatedEnv)).stdout);

      assert.notEqual(first.handle, second.handle);
      assert.notEqual(first.profile, second.profile);

      const listed = JSON.parse((await runCli(['list-profile'], isolatedEnv)).stdout);
      assert.equal(listed.status, 'ok');
      assert.equal(listed.items.length, 2);
      assert.equal(listed.default_profile, second.profile);

      const switched = JSON.parse((await runCli(['login', '--profile', first.profile], isolatedEnv)).stdout);
      assert.equal(switched.profile, first.profile);
      assert.equal(switched.handle, first.handle);
    } finally {
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    }
  });
});
