const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const CLIENT_PATH = require.resolve('../src/client');
const TOWN_CLIENT_PATH = require.resolve('../../../shared/town-client');

const originalClientModule = require.cache[CLIENT_PATH];
const originalTownClientModule = require.cache[TOWN_CLIENT_PATH];

function clearModules() {
  delete require.cache[CLIENT_PATH];
  delete require.cache[TOWN_CLIENT_PATH];
}

afterEach(() => {
  clearModules();
  if (originalClientModule) require.cache[CLIENT_PATH] = originalClientModule;
  if (originalTownClientModule) require.cache[TOWN_CLIENT_PATH] = originalTownClientModule;
});

describe('bridge client serialization', () => {
  it('runs overlapping actions against the active session one at a time', async () => {
    const events = [];

    class MockSessionHandle {
      resolveProfileName() {
        return 'mock-profile';
      }

      async request(_method, path) {
        events.push(`start:${path}`);
        await new Promise((resolve) => setTimeout(resolve, path === '/api/look' ? 20 : 0));
        events.push(`end:${path}`);
        return {
          auth: null,
          result: { player: { x: 5, y: 5, zone: '小镇街道', zoneDesc: '空旷的街道' }, nearby: [] },
          profile: { profile: 'mock-profile' },
        };
      }

      async heartbeat() {
        events.push('heartbeat');
        return { ok: true };
      }
    }

    require.cache[TOWN_CLIENT_PATH] = {
      exports: {
        SessionHandle: MockSessionHandle,
        HEARTBEAT_INTERVAL_MS: 60_000,
        listProfiles: () => ({}),
        discoverServer: async () => 'http://example.test',
        requestJson: async () => ({}),
        formatLogin: () => '',
        formatProfilesList: () => '',
        formatCharacters: () => '',
        formatMap: () => '',
        formatLook: () => '',
        formatWalk: () => '',
        formatSay: () => '',
        formatInteract: () => '',
      },
    };

    const client = require('../src/client');

    await Promise.all([
      client.look(),
      client.walk('E', 1),
    ]);

    assert.deepEqual(events, [
      'start:/api/look',
      'end:/api/look',
      'start:/api/walk',
      'end:/api/walk',
    ]);
  });
});
