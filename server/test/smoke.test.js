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
      timeout: 5000,
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

    const walk = await request('POST', '/api/walk', { direction: 'E', steps: 2 }, headers);
    assert.equal(walk.status, 200);
    assert.equal(walk.body.actualSteps, 2);

    const say = await request('POST', '/api/say', { text: 'hello' }, headers);
    assert.equal(say.status, 200);

    const interact = await request('POST', '/api/interact', null, headers);
    assert.equal(interact.status, 200);
    assert.ok(interact.body.zone);

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

  it('restores the last known position after re-login', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'ReturnBot',
      sprite: 'Samurai',
      publicKey: authMaterial.publicJwk.x,
    });

    const firstTimestamp = Date.now();
    const firstLogin = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp: firstTimestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, firstTimestamp),
    });
    const firstHeaders = { Authorization: `Bearer ${firstLogin.body.token}` };

    const walk = await request('POST', '/api/walk', { direction: 'E', steps: 3 }, firstHeaders);
    assert.equal(walk.status, 200);
    assert.equal(walk.body.player.x, 8);
    assert.equal(walk.body.player.y, 5);

    const secondTimestamp = Date.now() + 1;
    const secondLogin = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp: secondTimestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, secondTimestamp),
    });

    assert.equal(secondLogin.status, 200);
    assert.equal(secondLogin.body.player.x, 8);
    assert.equal(secondLogin.body.player.y, 5);
    assert.equal(secondLogin.body.login_mode, 'resume');
  });

  it('supports explicit respawn back to the starting point', async () => {
    const authMaterial = generateAuthMaterial();
    const created = await request('POST', '/api/profiles/create', {
      name: 'RespawnBot',
      sprite: 'Samurai',
      publicKey: authMaterial.publicJwk.x,
    });

    const firstTimestamp = Date.now();
    const firstLogin = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp: firstTimestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, firstTimestamp),
    });
    const firstHeaders = { Authorization: `Bearer ${firstLogin.body.token}` };

    const walk = await request('POST', '/api/walk', { direction: 'E', steps: 3 }, firstHeaders);
    assert.equal(walk.status, 200);
    assert.equal(walk.body.player.x, 8);
    assert.equal(walk.body.player.y, 5);

    const secondTimestamp = Date.now() + 1;
    const secondLogin = await request('POST', '/api/login', {
      handle: created.body.handle,
      timestamp: secondTimestamp,
      signature: signLogin(created.body.handle, authMaterial.privateJwk, secondTimestamp),
      loginMode: 'spawn',
    });

    assert.equal(secondLogin.status, 200);
    assert.equal(secondLogin.body.login_mode, 'spawn');
    assert.equal(secondLogin.body.player.x, 5);
    assert.equal(secondLogin.body.player.y, 5);
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
    worldEngine.pruneExpiredSessions();
    const players = await request('GET', '/api/players');
    assert.equal(players.body.players[playerId], undefined);

    const failedHeartbeat = await request('POST', '/api/session/heartbeat', null, headers);
    assert.equal(failedHeartbeat.status, 401);
  });
  it('rejects removed legacy session endpoints', async () => {
    const join = await request('POST', '/api/join', { name: 'LegacyJoin', sprite: 'Monk' });
    assert.equal(join.status, 404);

    const leave = await request('POST', '/api/leave', null, { 'X-Session-Id': 'legacy-session' });
    assert.equal(leave.status, 404);
  });
});
