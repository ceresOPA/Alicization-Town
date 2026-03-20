const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { formatLook } = require('../../../shared/town-client/formatters');

function createLookResult(overrides = {}) {
  return {
    player: {
      x: 5,
      y: 5,
      zone: 'Town Center',
      zoneDesc: 'Central square',
      ...overrides.player,
    },
    nearby: overrides.nearby ?? [],
  };
}

describe('formatLook', () => {
  it('renders the empty nearby state without losing location text', () => {
    const output = formatLook(createLookResult());

    assert.match(output, /位置感知/);
    assert.match(output, /\(5, 5\)/);
    assert.match(output, /Town Center/);
    assert.match(output, /Central square/);
    assert.match(output, /四周空无一人/);
    assert.doesNotMatch(output, /附近的人/);
  });

  it('preserves distance, zone, and message text while appending relative direction', () => {
    const output = formatLook(createLookResult({
      nearby: [
        {
          name: 'Alice',
          distance: 2,
          relativeDirection: '左前方',
          zone: 'Town Center',
          message: 'hello',
        },
      ],
    }));

    assert.match(output, /附近的人/);
    assert.match(output, /Alice 距离你 2 步 \(位于 Town Center\)，在你的左前方，他正在说: "hello"/);
  });
});
