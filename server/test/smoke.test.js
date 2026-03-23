const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const TEMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alicization-town-server-'));
process.env.ALICIZATION_TOWN_SERVER_HOME = TEMP_HOME;
process.env.ALICIZATION_TOWN_LEASE_TTL_MS = '120';
process.env.ALICIZATION_TOWN_IDLE_AFTER_MS = '30';
process.env.ALICIZATION_TOWN_TOKEN_TTL_MS = '1000';

const MAP_PATH = path.join(__dirname, '..', 'web', 'assets', 'map.tmj');
const worldEngine = require('../src/engine/world-engine');
const { describeRelativeDirection } = require('../src/engine/relative-direction');

function request(method, apiPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 5661,
      path: apiPath,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 15000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function generateAuthMaterial() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicJwk: publicKey.export({ format: 'jwk' }),
    privateJwk: privateKey.export({ format: 'jwk' }),
  };
}

function signLogin(handle, privateJwk, timestamp) {
  const key = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  return crypto.sign(null, Buffer.from(`alicization-town:login:${handle}:${timestamp}`, 'utf8'), key).toString('base64url');
}

describe('World Engine (unit)', () => {
  it('init loads zones from map.tmj', () => {
    worldEngine.init(MAP_PATH);
    assert.ok(worldEngine.getMapDirectory().length > 0);
  });

  it('createProfile returns stable outward handles', () => {
    const keyA = generateAuthMaterial();
    const keyB = generateAuthMaterial();
    const left = worldEngine.createProfile('Alpha', 'Boy', keyA.publicJwk.x);
    const right = worldEngine.createProfile('Beta', 'Samurai', keyB.publicJwk.x);
    assert.match(left.handle, /^at_[a-f0-9]{24}$/);
    assert.match(right.handle, /^at_[a-f0-9]{24}$/);
    assert.notEqual(left.handle, right.handle);
  });

  it('covers left/right/front/back and all diagonal relative directions', () => {
    const cases = [
      { dx: -1, dy: -1, facing: 'N', expected: '左前方' },
      { dx: 0, dy: -1, facing: 'N', expected: '前方' },
      { dx: 1, dy: -1, facing: 'N', expected: '右前方' },
      { dx: -1, dy: 0, facing: 'N', expected: '左侧' },
      { dx: 1, dy: 0, facing: 'N', expected: '右侧' },
      { dx: -1, dy: 1, facing: 'N', expected: '左后方' },
      { dx: 0, dy: 1, facing: 'N', expected: '后方' },
      { dx: 1, dy: 1, facing: 'N', expected: '右后方' },
    ];

    for (const { dx, dy, facing, expected } of cases) {
      assert.equal(describeRelativeDirection(dx, dy, facing), expected);
    }
  });

  it('rotates relative direction with player facing', () => {
    assert.equal(describeRelativeDirection(1, 0, 'S'), '左侧');
    assert.equal(describeRelativeDirection(0, -1, 'E'), '左侧');
    assert.equal(describeRelativeDirection(0, -1, 'W'), '右侧');
  });

});

describe('HTTP API (integration)', () => {
  let server;

  before(async () => {
    await new Promise((resolve) => {
      const express = require('express');
      const app = express();
      const apiRouter = require('../src/routes');
      worldEngine.init(MAP_PATH);
      app.use('/api', apiRouter);
      server = app.listen(5661, resolve);
    });
  });

  after(() => {
    worldEngine.shutdown();
    server?.close();
    fs.rmSync(TEMP_HOME, { recursive: true, force: true });
  });

  it('GET /api/characters returns array', async () => {
    const { status, body } = await request('GET', '/api/characters');
    assert.equal(status, 200);
    assert.equal(body.characters.length, 12);
  });

  it('supports profile create -> login -> heartbeat -> action lifecycle', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'Alice',
      sprite: 'Princess',
      publicKey: authMaterial.publicJwk.x,
    });
    assert.equal(created.status, 200);
    assert.match(created.body.handle, /^at_[a-f0-9]{24}$/);

    const timestamp = Date.now();
    const login = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, timestamp),
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.status, 'authenticated');
    assert.ok(login.body.token);

    const headers = { Authorization: `Bearer ${login.body.token}` };
    const heartbeat = await request('POST', '/api/session/heartbeat', null, headers);
    assert.equal(heartbeat.status, 200);
    assert.ok(heartbeat.body.lease_expires_at);

    const map = await request('GET', '/api/map', null, headers);
    assert.equal(map.status, 200);
    assert.ok(Array.isArray(map.body.directory));

    const look = await request('GET', '/api/look', null, headers);
    assert.equal(look.status, 200);
    assert.equal(look.body.player.name, 'Alice');

    const walk = await request('POST', '/api/walk', { forward: 2 }, headers);
    assert.equal(walk.status, 200);
    assert.ok(walk.body.arrived);
    assert.ok(walk.body.pathLength >= 0);

    const say = await request('POST', '/api/chat', { text: 'hello' }, headers);
    assert.equal(say.status, 200);

    const interact = await request('POST', '/api/interact', null, headers);
    assert.equal(interact.status, 200);
    assert.ok(interact.body.zone);
    assert.ok(Array.isArray(interact.body.perceptions));
    assert.ok(Array.isArray(interact.body.newMessages));

    const logout = await request('POST', '/api/logout', null, headers);
    assert.equal(logout.status, 200);
  });

  it('new login takes over the old session', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'Takeover',
      sprite: 'Boy',
      publicKey: authMaterial.publicJwk.x,
    });

    const firstTimestamp = Date.now();
    const firstLogin = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp: firstTimestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, firstTimestamp),
    });

    const secondTimestamp = Date.now() + 1;
    const secondLogin = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp: secondTimestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, secondTimestamp),
    });

    assert.equal(secondLogin.status, 200);
    assert.equal(secondLogin.body.status, 'took_over_session');

    const staleLook = await request('GET', '/api/look', null, {
      Authorization: `Bearer ${firstLogin.body.token}`,
    });
    assert.equal(staleLook.status, 401);
  });

  it('marks online players idle and then offline based on timers', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'IdleBot',
      sprite: 'Monk',
      publicKey: authMaterial.publicJwk.x,
    });
    const timestamp = Date.now();
    const login = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, timestamp),
    });
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const playerId = login.body.player.id;

    await new Promise((resolve) => setTimeout(resolve, 40));
    const idlePlayers = await request('GET', '/api/players');
    assert.equal(idlePlayers.body.players[playerId].presenceState, 'idle');

    await new Promise((resolve) => setTimeout(resolve, 130));
    let players = await request('GET', '/api/players');
    assert.equal(players.body.players[playerId].presenceState, 'offline');

    await new Promise((resolve) => setTimeout(resolve, 900));
    worldEngine.pruneExpiredSessions();
    players = await request('GET', '/api/players');
    assert.equal(players.body.players[playerId], undefined);

    const failedHeartbeat = await request('POST', '/api/session/heartbeat', null, headers);
    assert.equal(failedHeartbeat.status, 401);
  });

  it('keeps queued perceptions and chat deltas when an authenticated request fails validation', async () => {
    const speakerKeys = generateAuthMaterial();
    const listenerKeys = generateAuthMaterial();
    const speakerCreated = await request('POST', '/api/profiles/create', {
      name: 'SpeakerBot',
      sprite: 'Boy',
      publicKey: speakerKeys.publicJwk.x,
    });
    const listenerCreated = await request('POST', '/api/profiles/create', {
      name: 'ListenerBot',
      sprite: 'Princess',
      publicKey: listenerKeys.publicJwk.x,
    });

    const speakerTimestamp = Date.now();
    const speakerLogin = await request('POST', '/api/login', {
      handle: speakerCreated.body.handle,
      timestamp: speakerTimestamp,
      signature: signLogin(speakerCreated.body.handle, speakerKeys.privateJwk, speakerTimestamp),
    });
    const listenerTimestamp = Date.now() + 1;
    const listenerLogin = await request('POST', '/api/login', {
      handle: listenerCreated.body.handle,
      timestamp: listenerTimestamp,
      signature: signLogin(listenerCreated.body.handle, listenerKeys.privateJwk, listenerTimestamp),
    });

    const speakerHeaders = { Authorization: `Bearer ${speakerLogin.body.token}` };
    const listenerHeaders = { Authorization: `Bearer ${listenerLogin.body.token}` };

    const spoke = await request('POST', '/api/chat', { text: '有人在吗？' }, speakerHeaders);
    assert.equal(spoke.status, 200);

    const invalidWalk = await request('POST', '/api/walk', {}, listenerHeaders);
    assert.equal(invalidWalk.status, 400);

    const perceptions = await request('GET', '/api/perceptions', null, listenerHeaders);
    assert.equal(perceptions.status, 200);
    assert.equal(perceptions.body.perceptions.length, 1);
    assert.equal(perceptions.body.perceptions[0].type, 'chat');
    assert.equal(perceptions.body.newMessages.length, 1);
    assert.equal(perceptions.body.newMessages[0].message, '有人在吗？');

    await request('POST', '/api/logout', null, speakerHeaders);
    await request('POST', '/api/logout', null, listenerHeaders);
  });

  it('uses a stable chat cursor when multiple messages share the same timestamp', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'ChatBot',
      sprite: 'Samurai',
      publicKey: authMaterial.publicJwk.x,
    });
    const timestamp = Date.now();
    const login = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, timestamp),
    });
    const headers = { Authorization: `Bearer ${login.body.token}` };

    const originalNow = Date.now;
    const fixedNow = originalNow();
    Date.now = () => fixedNow;
    try {
      const firstSay = await request('POST', '/api/chat', { text: '第一句' }, headers);
      const secondSay = await request('POST', '/api/chat', { text: '第二句' }, headers);
      assert.equal(firstSay.status, 200);
      assert.equal(secondSay.status, 200);
    } finally {
      Date.now = originalNow;
    }

    const recentMessages = worldEngine.getChatHistory()
      .filter((message) => message.message === '第一句' || message.message === '第二句')
      .slice(-2);
    assert.equal(recentMessages.length, 2);
    assert.equal(recentMessages[0].time, recentMessages[1].time);

    const secondPage = await request('GET', `/api/chat?since=${encodeURIComponent(`${recentMessages[0].time}:${recentMessages[0].id}`)}&limit=1`);
    assert.equal(secondPage.status, 200);
    assert.equal(secondPage.body.messages.length, 1);
    assert.equal(secondPage.body.messages[0].message, '第二句');

    await request('POST', '/api/logout', null, headers);
  });

  it('walks to a named zone via pathfinding', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'PathBot',
      sprite: 'Boy',
      publicKey: authMaterial.publicJwk.x,
    });
    const timestamp = Date.now();
    const login = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, timestamp),
    });
    const headers = { Authorization: `Bearer ${login.body.token}` };

    const map = await request('GET', '/api/map', null, headers);
    assert.ok(Array.isArray(map.body.directory));
    assert.ok(map.body.directory.length > 0);
    const target = map.body.directory[0];

    const walk = await request('POST', '/api/walk', { to: target.id }, headers);
    assert.equal(walk.status, 200);
    assert.ok(walk.body.arrived);
    assert.ok(walk.body.pathLength >= 0);
    assert.ok(walk.body.targetZone);

    await request('POST', '/api/logout', null, headers);
  });

  it('serializes concurrent actions on the same player via action lock', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'ConcurrentBot',
      sprite: 'Princess',
      publicKey: authMaterial.publicJwk.x,
    });
    const timestamp = Date.now();
    const login = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, timestamp),
    });
    const headers = { Authorization: `Bearer ${login.body.token}` };

    const walkPromise = request('POST', '/api/walk', { forward: 3 }, headers);
    const chatPromise = request('POST', '/api/chat', { text: '并发测试' }, headers);
    const [walkResult, chatResult] = await Promise.all([walkPromise, chatPromise]);

    assert.equal(walkResult.status, 200);
    assert.ok(walkResult.body.arrived);
    assert.equal(chatResult.status, 200);

    await request('POST', '/api/logout', null, headers);
  });

  it('allows different players to walk concurrently without blocking each other', async () => {
    const authA = generateAuthMaterial();
    const authB = generateAuthMaterial();
    const createdA = await request('POST', '/api/profiles/create', { name: 'ParaA', sprite: 'Boy', publicKey: authA.publicJwk.x });
    const createdB = await request('POST', '/api/profiles/create', { name: 'ParaB', sprite: 'Samurai', publicKey: authB.publicJwk.x });
    const tsA = Date.now();
    const tsB = Date.now() + 1;
    const loginA = await request('POST', '/api/login', { handle: createdA.body.handle, timestamp: tsA, signature: signLogin(createdA.body.handle, authA.privateJwk, tsA) });
    const loginB = await request('POST', '/api/login', { handle: createdB.body.handle, timestamp: tsB, signature: signLogin(createdB.body.handle, authB.privateJwk, tsB) });
    const headersA = { Authorization: `Bearer ${loginA.body.token}` };
    const headersB = { Authorization: `Bearer ${loginB.body.token}` };

    const [walkA, walkB] = await Promise.all([
      request('POST', '/api/walk', { forward: 3 }, headersA),
      request('POST', '/api/walk', { forward: 3 }, headersB),
    ]);

    assert.equal(walkA.status, 200);
    assert.ok(walkA.body.arrived);
    assert.equal(walkB.status, 200);
    assert.ok(walkB.body.arrived);

    await request('POST', '/api/logout', null, headersA);
    await request('POST', '/api/logout', null, headersB);
  });

  it('GET /api/npcs returns an array', async () => {
    const { status, body } = await request('GET', '/api/npcs');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.npcs));
  });

  it('rejects walk requests with invalid or missing parameters', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'ErrorBot',
      sprite: 'Monk',
      publicKey: authMaterial.publicJwk.x,
    });
    const timestamp = Date.now();
    const login = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, timestamp),
    });
    const headers = { Authorization: `Bearer ${login.body.token}` };

    const noParams = await request('POST', '/api/walk', {}, headers);
    assert.equal(noParams.status, 400);

    const badZone = await request('POST', '/api/walk', { to: 'nonexistent_zone#ffff' }, headers);
    assert.equal(badZone.status, 400);
    assert.ok(badZone.body.error);

  });

  it('auto-rejoins a player after ghost cleanup when token is still valid', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'GhostBot',
      sprite: 'Princess',
      publicKey: authMaterial.publicJwk.x,
    });
    const timestamp = Date.now();
    const login = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, timestamp),
    });
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const playerId = login.body.player.id;

    // Wait for lease to expire (120ms in test env) so player goes offline
    await new Promise((resolve) => setTimeout(resolve, 130));
    worldEngine.pruneExpiredSessions();

    // Player should be removed from memory
    let players = await request('GET', '/api/players');
    assert.equal(players.body.players[playerId], undefined);

    // Token TTL is 1000ms so token is still valid — heartbeat should auto-rejoin
    const heartbeat = await request('POST', '/api/session/heartbeat', null, headers);
    assert.equal(heartbeat.status, 200);
    assert.ok(heartbeat.body.ok);

    // Player should be back in the game
    players = await request('GET', '/api/players');
    assert.ok(players.body.players[playerId]);
    assert.equal(players.body.players[playerId].name, 'GhostBot');

    // Authenticated requests should work normally
    const look = await request('GET', '/api/look', null, headers);
    assert.equal(look.status, 200);
    assert.equal(look.body.player.name, 'GhostBot');

    await request('POST', '/api/logout', null, headers);
  });

  it('rejects login with invalid signature', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'BadSigBot',
      sprite: 'Boy',
      publicKey: authMaterial.publicJwk.x,
    });
    const timestamp = Date.now();
    const wrongKey = generateAuthMaterial();
    const badLogin = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp,
      signature: signLogin(created.body.handle, wrongKey.privateJwk, timestamp),
    });
    assert.equal(badLogin.status, 401);
  });

  it('rejects login with expired timestamp', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'ExpiredBot',
      sprite: 'Samurai',
      publicKey: authMaterial.publicJwk.x,
    });
    const staleTimestamp = Date.now() - 120_000;
    const expiredLogin = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp: staleTimestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, staleTimestamp),
    });
    assert.equal(expiredLogin.status, 401);
  });

  it('rejects login with unknown handle', async () => {
    const authMaterial = generateAuthMaterial();
    const timestamp = Date.now();
    const unknownLogin = await request('POST', '/api/login', {
      handle: 'at_nonexistent_handle_000000',
      timestamp,
      signature: signLogin('at_nonexistent_handle_000000', authMaterial.privateJwk, timestamp),
    });
    assert.equal(unknownLogin.status, 404);
  });

  it('rejects requests with empty or malformed tokens', async () => {
    const noToken = await request('GET', '/api/look');
    assert.equal(noToken.status, 401);

    const emptyBearer = await request('GET', '/api/look', null, { Authorization: 'Bearer ' });
    assert.equal(emptyBearer.status, 401);

    const garbageToken = await request('GET', '/api/look', null, { Authorization: 'Bearer garbage-token-12345' });
    assert.equal(garbageToken.status, 401);

    const heartbeatNoToken = await request('POST', '/api/session/heartbeat');
    assert.equal(heartbeatNoToken.status, 401);

    const heartbeatBadToken = await request('POST', '/api/session/heartbeat', null, { Authorization: 'Bearer bad-token' });
    assert.equal(heartbeatBadToken.status, 401);
  });
});
