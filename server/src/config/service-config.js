const os = require('os');
const path = require('path');

const MESSAGE_TTL_MS = 5_000;
const INTERACTION_TTL_MS = 4_000;

const NEARBY_RANGE = 20;
const MAX_CHAT_MESSAGES = 50;
const MAX_PLAYER_ACTIVITIES = 20;
const IDLE_AFTER_MS = Number(process.env.ALICIZATION_TOWN_IDLE_AFTER_MS || 30_000);
const LEASE_TTL_MS = Number(process.env.ALICIZATION_TOWN_LEASE_TTL_MS || 180_000);
const TOKEN_TTL_MS = Number(process.env.ALICIZATION_TOWN_TOKEN_TTL_MS || 24 * 60 * 60 * 1000);
const MOVE_TICK_MS = Number(process.env.ALICIZATION_TOWN_MOVE_TICK_MS || 200);
const LOGIN_PROOF_TTL_MS = Number(process.env.ALICIZATION_TOWN_LOGIN_PROOF_TTL_MS || 60_000);
const SERVER_MACHINE_ID = 1;
const SNOWFLAKE_EPOCH_MS = Date.UTC(2026, 0, 1);

const DATA_ROOT = process.env.ALICIZATION_TOWN_SERVER_HOME
  ? path.resolve(process.env.ALICIZATION_TOWN_SERVER_HOME)
  : path.join(os.homedir(), '.agents', 'data', 'alicization-town-server');

const DATABASE_FILE = path.join(DATA_ROOT, 'server-state.sqlite');

module.exports = {
  MESSAGE_TTL_MS,
  INTERACTION_TTL_MS,

  NEARBY_RANGE,
  MAX_CHAT_MESSAGES,
  MAX_PLAYER_ACTIVITIES,
  IDLE_AFTER_MS,
  LEASE_TTL_MS,
  TOKEN_TTL_MS,
  MOVE_TICK_MS,
  LOGIN_PROOF_TTL_MS,
  SERVER_MACHINE_ID,
  SNOWFLAKE_EPOCH_MS,
  DATA_ROOT,
  DATABASE_FILE,
};
