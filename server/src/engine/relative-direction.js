function normalizeDelta(value) {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function toRelativeAxes(dx, dy, facing = 'S') {
  const stepX = normalizeDelta(dx);
  const stepY = normalizeDelta(dy);

  switch (facing) {
    case 'N':
      return { side: stepX, depth: -stepY };
    case 'S':
      return { side: -stepX, depth: stepY };
    case 'E':
      return { side: stepY, depth: stepX };
    case 'W':
      return { side: -stepY, depth: -stepX };
    default:
      return { side: -stepX, depth: stepY };
  }
}

function describeRelativeDirection(dx, dy, facing = 'S') {
  const { side, depth } = toRelativeAxes(dx, dy, facing);

  if (side === 0 && depth === 0) return '附近';
  if (depth > 0 && side < 0) return '左前方';
  if (depth > 0 && side === 0) return '前方';
  if (depth > 0 && side > 0) return '右前方';
  if (depth === 0 && side < 0) return '左侧';
  if (depth === 0 && side > 0) return '右侧';
  if (depth < 0 && side < 0) return '左后方';
  if (depth < 0 && side === 0) return '后方';
  return '右后方';
}

module.exports = { describeRelativeDirection };
