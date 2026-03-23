// Per-player action mutex via Promise chain.
// Ensures only one mutating action (walk/chat/interact/status) runs at a time per player.

const locks = new Map();

function acquire(playerId) {
  const prev = locks.get(playerId) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  locks.set(playerId, next);
  // Wait for previous action to finish, then hand back the release function
  return prev.then(() => release);
}

function remove(playerId) {
  locks.delete(playerId);
}

module.exports = { acquire, remove };
