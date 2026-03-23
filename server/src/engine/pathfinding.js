// A* pathfinding on a 2D grid with binary collision map

class MinHeap {
  constructor() {
    this.data = [];
  }

  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }

  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  get size() {
    return this.data.length;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].f >= this.data[parent].f) break;
      [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < n && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest === i) break;
      [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
      i = smallest;
    }
  }
}

const DIRECTIONS = [
  { dx: 0, dy: -1 }, // N
  { dx: 0, dy: 1 },  // S
  { dx: -1, dy: 0 }, // W
  { dx: 1, dy: 0 },  // E
];

/**
 * Find shortest path from (sx,sy) to (gx,gy) on a grid with collision.
 * @param {number[]} collisionMap - flat array, 1 = blocked
 * @param {number} width - grid width
 * @param {number} height - grid height
 * @param {number} sx - start x
 * @param {number} sy - start y
 * @param {number} gx - goal x
 * @param {number} gy - goal y
 * @returns {{ path: {x:number,y:number}[], reachable: boolean }}
 *   path includes start and goal; empty + unreachable if no path exists.
 */
function findPath(collisionMap, width, height, sx, sy, gx, gy) {
  if (sx === gx && sy === gy) return { path: [{ x: sx, y: sy }], reachable: true };

  if (gx < 0 || gx >= width || gy < 0 || gy >= height) return { path: [], reachable: false };
  if (collisionMap[gy * width + gx] === 1) return { path: [], reachable: false };

  const open = new MinHeap();
  const gScore = new Map();
  const cameFrom = new Map();

  const key = (x, y) => y * width + x;
  const heuristic = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);

  const startKey = key(sx, sy);
  gScore.set(startKey, 0);
  open.push({ x: sx, y: sy, f: heuristic(sx, sy), g: 0 });

  while (open.size > 0) {
    const current = open.pop();
    const ck = key(current.x, current.y);

    if (current.x === gx && current.y === gy) {
      const path = [];
      let k = ck;
      while (k !== undefined) {
        const py = Math.floor(k / width);
        const px = k % width;
        path.push({ x: px, y: py });
        k = cameFrom.get(k);
      }
      path.reverse();
      return { path, reachable: true };
    }

    if (current.g > (gScore.get(ck) ?? Infinity)) continue;

    for (const { dx, dy } of DIRECTIONS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nk = key(nx, ny);
      if (collisionMap[nk] === 1) continue;

      const tentativeG = current.g + 1;
      if (tentativeG < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentativeG);
        cameFrom.set(nk, ck);
        open.push({ x: nx, y: ny, f: tentativeG + heuristic(nx, ny), g: tentativeG });
      }
    }
  }

  return { path: [], reachable: false };
}

/**
 * Find the nearest walkable tile to (tx,ty) using BFS spiral.
 * Returns the tile itself if already walkable.
 * @returns {{ x: number, y: number } | null}
 */
function findNearestWalkable(collisionMap, width, height, tx, ty) {
  if (tx < 0 || tx >= width || ty < 0 || ty >= height) {
    tx = Math.max(0, Math.min(tx, width - 1));
    ty = Math.max(0, Math.min(ty, height - 1));
  }
  if (collisionMap[ty * width + tx] !== 1) return { x: tx, y: ty };

  const visited = new Set();
  const queue = [{ x: tx, y: ty }];
  visited.add(ty * width + tx);

  while (queue.length > 0) {
    const { x, y } = queue.shift();
    for (const { dx, dy } of DIRECTIONS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nk = ny * width + nx;
      if (visited.has(nk)) continue;
      visited.add(nk);
      if (collisionMap[nk] !== 1) return { x: nx, y: ny };
      queue.push({ x: nx, y: ny });
    }
  }

  return null;
}

module.exports = { findPath, findNearestWalkable };
