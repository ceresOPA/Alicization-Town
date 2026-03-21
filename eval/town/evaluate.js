#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

function loadSocketClient() {
  try {
    return require('socket.io-client');
  } catch (error) {
    try {
      return require(path.join(ROOT, 'node_modules', 'socket.io-client'));
    } catch (innerError) {
      return require(path.join(ROOT, 'server', 'node_modules', 'socket.io-client'));
    }
  }
}

const ROOT = path.resolve(__dirname, '..', '..');
const EVALUATION_ROOT = __dirname;
const REPORTS_ROOT = path.join(EVALUATION_ROOT, 'reports');
const SCENARIO_PATH = path.join(EVALUATION_ROOT, 'scenarios', 'resident-walkthrough.json');
const SCHEMA_PATH = path.join(EVALUATION_ROOT, 'schemas', 'resident-outcome.schema.json');
const SKILL_PATH = path.join(ROOT, 'skills', 'alicization-town', 'SKILL.md');
const TOWN_CLI_BIN_DIR = path.join(ROOT, 'skills', 'alicization-town', 'scripts');
const SERVER_PORT = 5660;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const BOT_SPRITE = 'Samurai';
const FIXED_GREETING = '大家好！我是刚来到这个小镇的新居民，请多多关照！';
const RESIDENT_NAME_POOL = [
  '云晨', '秋水', '初晴', '流星', '天青', '小雨', '朝露', '安宁',
  '风铃', '月见', '若叶', '石磨', '雪彦', '草原', '铃音', '桂娘',
  '火星', '木棉', '海棠', '峰云', '夏雪', '寒江', '碧荷', '白鹽',
];
const SUPPORTED_ENGINES = ['claude-code', 'codex'];
const SUPPORTED_MODES = ['mcp', 'skill', 'native-skill'];
const MAX_ENGINE_DURATION_MS = 300000;
const GLOBAL_DEADLINE_MS = 900000;
const MAX_CONCURRENCY = 5;
const DEFAULT_CONCURRENCY = 1;
const OBSERVER_SETTLE_MS = 1800;
const PERSONA_LEAK_WORDS = ['MCP', '工具', '测试', '评测', 'engine', '引擎', 'JSON', 'schema', 'agent', '机器人', 'API', '协议', 'prompt', '模型'];
const TASK_MODE_PATTERNS = [/完成了?(?:步骤|任务|目标|指令)/, /步骤\s*\d/, /(?:成功|失败)(?:执行|完成|调用)/, /\(\d+[,，]\s*\d+\)/];
let cachedSkillText = null;
let townCliBuilt = false;
let cachedSocketClient = null;

function getSocketIo() {
  if (!cachedSocketClient) {
    cachedSocketClient = loadSocketClient();
  }
  return cachedSocketClient.io;
}

function parseArgs(argv) {
  const selected = [];
  const modes = [];
  let scenarioFilter = null;
  let keepServer = false;
  let listEngines = false;
  let listModes = false;
  let concurrency = DEFAULT_CONCURRENCY;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--engine' && argv[index + 1]) {
      selected.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith('--engine=')) {
      selected.push(value.split('=')[1]);
      continue;
    }
    if (value === '--mode' && argv[index + 1]) {
      modes.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith('--mode=')) {
      modes.push(value.split('=')[1]);
      continue;
    }
    if (value === '--scenario' && argv[index + 1]) {
      scenarioFilter = argv[index + 1];
      index += 1;
      continue;
    }
    if (value.startsWith('--scenario=')) {
      scenarioFilter = value.split('=')[1];
      continue;
    }
    if (value === '--concurrency' && argv[index + 1]) {
      concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(argv[index + 1]) || DEFAULT_CONCURRENCY));
      index += 1;
      continue;
    }
    if (value.startsWith('--concurrency=')) {
      concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(value.split('=')[1]) || DEFAULT_CONCURRENCY));
      continue;
    }
    if (value === '--keep-server') {
      keepServer = true;
      continue;
    }
    if (value === '--list-engines') {
      listEngines = true;
      continue;
    }
    if (value === '--list-modes') {
      listModes = true;
    }
  }

  return {
    engines: selected,
    modes,
    scenarioFilter,
    keepServer,
    listEngines,
    listModes,
    concurrency,
  };
}

function filterScenarios(scenarios, filter) {
  if (!filter) return scenarios;
  if (/^\d+$/.test(filter)) return scenarios.filter((s) => s.id === Number(filter));
  return scenarios.filter((s) => s.name.includes(filter));
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function writeJson(target, value) {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(target, value) {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, value, 'utf8');
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function timestampStamp(date = new Date()) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    'T',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
    String(date.getMilliseconds()).padStart(3, '0'),
  ];
  return parts.join('');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    function finish(result) {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    }

    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

async function waitForPort(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function findListeningPid(port) {
  const result = spawnSync('lsof', ['-tiTCP:' + String(port), '-sTCP:LISTEN'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const match = result.stdout.trim().split(/\s+/).find(Boolean);
  return match ? Number(match) : null;
}

async function ensureServer(runRoot) {
  const logPath = path.join(runRoot, 'server.log');
  const serverEnv = createServerEnv(runRoot);
  const existingPid = findListeningPid(SERVER_PORT);
  if (existingPid) {
    try {
      process.kill(existingPid, 'SIGTERM');
    } catch (error) {
      // 端口占用清理失败时继续尝试，后面还会做二次兜底。
    }
    await sleep(1000);
    if (await isPortOpen(SERVER_PORT)) {
      try {
        process.kill(existingPid, 'SIGKILL');
      } catch (error) {
        // 强杀也可能失败，但评测流程仍要继续探测端口状态。
      }
      await sleep(500);
    }
  }

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const child = spawn('node', ['server/src/main.js'], {
    cwd: ROOT,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  const ready = await waitForPort(SERVER_PORT, 10000);
  if (!ready) {
    child.kill('SIGKILL');
    throw new Error(`world server did not start on ${SERVER_URL}`);
  }

  return {
    owned: true,
    logPath,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await sleep(1000);
      }
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      logStream.end();
    },
  };
}


function buildResidentPrompt(scenario, botName = '这位居民') {
  const persona = [
    `你的名字叫${botName}，你刚来到 Alicization Town，是这里的新居民。`,
    '你会用眼前看到的地图、周围的环境、自己的脚步、说话和现场互动来认识这个地方。',
    '只把自己亲眼见到、亲身做到的内容当作事实。',
    '全程使用中文。',
  ];

  const mission = [
    scenario.brief,
  ];

  const format = [
    '走完以后，用你自己的话回忆这段经历。',
    '过程中不要解释自己在做什么。结束后仅输出结果对象。',
  ];

  return [...persona, '', ...mission, '', ...format].join('\n');
}

function isClaudeEngine(engineName) {
  return engineName === 'claude-code';
}

function isCodexEngine(engineName) {
  return engineName === 'codex';
}

function loadSkillText() {
  if (cachedSkillText == null) {
    cachedSkillText = fs.readFileSync(SKILL_PATH, 'utf8');
  }
  return cachedSkillText;
}

function buildSkillPrompt(scenario, botName) {
  const skillText = loadSkillText();
  const runtimeBinding = [
    '你现在挂载了一个本地 CLI skill。',
    '必须优先按这个 skill 提供的命令完成任务，不要走 MCP 工具路径。',
    `本轮固定连接地址为 ${SERVER_URL}。`,
    `本轮角色名必须使用 ${botName}。`,
    `首次配置时请使用 sprite=${BOT_SPRITE}。`,
    '结束后只输出结果对象。',
  ];

  return [
    ...runtimeBinding,
    '',
    '## Mounted Skill',
    '',
    '```markdown',
    skillText.trim(),
    '```',
    '',
    '## Resident Mission',
    '',
    buildResidentPrompt(scenario, botName),
  ].join('\n');
}

function buildNativeSkillPrompt(scenario, botName) {
  const lines = [
    `你是 Alicization Town 的新居民，名叫${botName}。`,
    `请使用 Alicization Town 技能来完成下面的任务。`,
    '',
    `连接地址: ${SERVER_URL}`,
    `角色名: ${botName}`,
    `角色形象: ${BOT_SPRITE}`,
    '',
    scenario.brief,
    '',
    '走完以后，用你自己的话回忆这段经历。',
    '过程中不要解释自己在做什么。结束后仅输出结果对象。',
  ];
  return lines.join('\n');
}

function createSkillEnv(runDir) {
  const skillHome = path.join(runDir, 'skill-home');
  const townCliHome = path.join(skillHome, 'alicization-town');
  ensureDir(townCliHome);
  return {
    ...process.env,
    ALICIZATION_TOWN_HOME: townCliHome,
    PATH: `${TOWN_CLI_BIN_DIR}:${process.env.PATH || ''}`,
  };
}

function createMcpEnv(runDir, botName) {
  const mcpHome = path.join(runDir, 'mcp-home', 'alicization-town');
  ensureDir(mcpHome);
  return {
    BOT_NAME: botName,
    BOT_SPRITE: BOT_SPRITE,
    SERVER_URL: SERVER_URL,
    ALICIZATION_TOWN_HOME: mcpHome,
  };
}

function createServerEnv(runDir) {
  const serverHome = path.join(runDir, 'server-home');
  fs.rmSync(serverHome, { recursive: true, force: true });
  ensureDir(serverHome);
  return {
    ...process.env,
    ALICIZATION_TOWN_SERVER_HOME: serverHome,
  };
}

function ensureClaudeSkillsDir() {
  const targetDir = path.join(ROOT, '.claude', 'skills', 'alicization-town');
  const sourceDir = path.join(ROOT, 'skills', 'alicization-town');
  if (fs.existsSync(targetDir)) {
    const stat = fs.lstatSync(targetDir);
    if (stat.isSymbolicLink()) {
      return;
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  ensureDir(path.dirname(targetDir));
  fs.symlinkSync(sourceDir, targetDir, 'dir');
}

function ensureTownCliBuilt(runRoot) {
  if (townCliBuilt) {
    return;
  }

  const result = spawnSync('npm', ['run', 'build:cli'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    shell: true,
  });

  if (result.status !== 0) {
    const logPath = path.join(runRoot, 'build-cli.log');
    writeText(logPath, `${result.stdout || ''}\n${result.stderr || ''}`.trim());
    throw new Error(`failed to build town CLI, see ${logPath}`);
  }

  townCliBuilt = true;
}

function createClaudeMcpConfig(targetPath, runDir, botName) {
  const config = {
    mcpServers: {
      'alicization-town': {
        command: 'node',
        args: ['packages/mcp-bridge/bin/bridge.js'],
        env: createMcpEnv(runDir, botName),
      },
    },
  };
  writeJson(targetPath, config);
}

function createObserver(botName, outputDir) {
  const summaryPath = path.join(outputDir, 'world-observation.json');
  const timelinePath = path.join(outputDir, 'world-timeline.jsonl');
  ensureDir(outputDir);

  let lastPlayers = {};
  const trackedStates = {};
  let connectError = null;
  let readyResolved = false;
  let finalSummary = null;
  let discoveredPlayerId = null;
  let discoveredPlayerName = null;

  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  const socket = getSocketIo()(SERVER_URL, {
    reconnection: false,
    timeout: 5000,
    transports: ['websocket', 'polling'],
  });

  const timeline = [];

  function discoverPlayer(players) {
    if (discoveredPlayerId) {
      return players[discoveredPlayerId] || Object.values(players).find((p) => p && p.id === discoveredPlayerId) || null;
    }
    const candidates = Object.values(players).filter((p) => p && p.name && p.name !== 'Observer');
    if (candidates.length === 0) return null;
    const exactMatch = candidates.find((p) => p.name === botName);
    if (exactMatch) {
      discoveredPlayerId = exactMatch.id;
      discoveredPlayerName = exactMatch.name;
      return exactMatch;
    }
    return null;
  }

  function snapshot(player) {
    if (!player) {
      return null;
    }
    return {
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      zone: player.currentZoneName || player.zone || '',
      message: player.message || '',
      interaction: player.interactionText || '',
      thinking: Boolean(player.isThinking),
    };
  }

  function stateChanged(next, previous) {
    return JSON.stringify(next) !== JSON.stringify(previous);
  }

  function scoreState(state) {
    if (!state) {
      return -1;
    }
    let score = 0;
    if (String(state.zone || '').trim().length > 0) {
      score += 1;
    }
    if (String(state.message || '').trim().length > 0) {
      score += 3;
    }
    if (String(state.interaction || '').trim().length > 0) {
      score += 3;
    }
    if (state.x !== 5 || state.y !== 5) {
      score += 2;
    }
    return score;
  }

  function selectFinalPlayer() {
    const current = snapshot(discoverPlayer(lastPlayers));
    const candidates = [];
    if (current) {
      candidates.push(current);
    }
    for (const record of timeline) {
      if (record && record.state) {
        candidates.push(record.state);
      }
    }
    if (candidates.length === 0) {
      return null;
    }
    const latestState = candidates[candidates.length - 1];
    const richestState = candidates.reduce((best, candidate) => {
      if (!best) {
        return candidate;
      }
      return scoreState(candidate) >= scoreState(best) ? candidate : best;
    }, null);
    const latestMessageState = [...candidates].reverse().find((state) => String(state.message || '').trim().length > 0);
    const latestInteractionState = [...candidates].reverse().find((state) => String(state.interaction || '').trim().length > 0);

    return {
      ...(latestState || {}),
      message: latestMessageState ? latestMessageState.message : (richestState ? richestState.message : ''),
      interaction: latestInteractionState ? latestInteractionState.interaction : (richestState ? richestState.interaction : ''),
    };
  }

  socket.on('connect', () => {
    if (!readyResolved) {
      readyResolved = true;
      readyResolve();
    }
  });

  socket.on('stateUpdate', (players) => {
    lastPlayers = players;
    const player = discoverPlayer(players);
    const next = snapshot(player);
    if (!next) {
      return;
    }
    const playerId = next.id || next.name;
    if (!stateChanged(next, trackedStates[playerId] || null)) {
      return;
    }
    const record = {
      ts: new Date().toISOString(),
      state: next,
    };
    timeline.push(record);
    fs.appendFileSync(timelinePath, `${JSON.stringify(record)}\n`, 'utf8');
    trackedStates[playerId] = next;
  });

  socket.on('connect_error', (error) => {
    connectError = error.message;
    if (!readyResolved) {
      readyResolved = true;
      readyResolve();
    }
  });

  async function finalize(reason) {
    if (finalSummary) {
      return finalSummary;
    }

    await sleep(OBSERVER_SETTLE_MS);
    const finalPlayer = selectFinalPlayer();
    finalSummary = {
      bot_name: discoveredPlayerName || botName,
      expected_name: botName,
      discovered_name: discoveredPlayerName,
      captured_until: new Date().toISOString(),
      reason,
      error: connectError,
      final_player: finalPlayer,
      timeline,
    };
    writeJson(summaryPath, finalSummary);
    socket.disconnect();
    return finalSummary;
  }

  return {
    ready,
    finalize,
  };
}

function trackToolMentions(rawText) {
  const toolPatterns = {
    read_map_directory: /read_map_directory|town\s+map|mcp__alicization-town__map/g,
    look_around: /look_around|town\s+look|mcp__alicization-town__look/g,
    walk: /\bwalk\b|town\s+walk|mcp__alicization-town__walk/g,
    chat: /\bchat\b|town\s+chat|mcp__alicization-town__chat/g,
    logout: /\blogout\b|town\s+logout|mcp__alicization-town__logout/g,
    interact: /\binteract\b|town\s+interact|mcp__alicization-town__interact/g,
  };
  const counts = {};

  for (const [toolName, pattern] of Object.entries(toolPatterns)) {
    const matches = rawText.match(pattern);
    counts[toolName] = matches ? matches.length : 0;
  }

  return counts;
}

function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const candidates = [];
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    candidates.push(fenced[1].trim());
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch && objectMatch[0]) {
    candidates.push(objectMatch[0].trim());
  }

  candidates.push(text.trim());

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      // 候选片段不合法就继续尝试下一个 JSON 片段。
    }
  }

  return null;
}

function extractChineseSummary(raw) {
  const candidates = [
    raw.summary, raw.第一印象, raw.感受, raw.感想, raw.总结, raw.经历,
    raw.小镇印象, raw.回忆, raw.体验, raw.心得,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  if (raw.地图印象 && typeof raw.地图印象 === 'object') {
    const parts = Object.values(raw.地图印象).filter((v) => typeof v === 'string');
    if (parts.length > 0) return parts.join('；');
  }
  if (raw.所见所遇 && Array.isArray(raw.所见所遇)) {
    return raw.所见所遇.join(' ');
  }
  if (raw.exploration_log && Array.isArray(raw.exploration_log)) {
    return raw.exploration_log.map((e) => e.observation || '').filter(Boolean).join(' ');
  }
  return '';
}

function extractChineseMessage(raw) {
  const candidates = [
    raw.spoken_message, raw.打招呼, raw.发言, raw.说的话, raw.问候, raw.message,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return '';
}

function extractChineseInteraction(raw) {
  const candidates = [
    raw.interaction_result, raw.互动结果, raw.互动, raw.交互结果,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
    if (c && typeof c === 'object') {
      return [c.action, c.outcome, c.result].filter(Boolean).join(' | ');
    }
  }
  return '';
}

function normalizeStructuredOutput(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  if (raw.task_completed !== undefined && raw.location && raw.spoken_message !== undefined) {
    return raw;
  }

  if (raw.location && raw.location.x !== undefined && raw.location.y !== undefined) {
    return {
      task_completed: raw.status === 'success' || raw.task_completed === true,
      location: {
        x: Number(raw.location.x),
        y: Number(raw.location.y),
        zone: raw.location.zone || raw.location.area || '',
      },
      spoken_message: raw.spoken_message || extractChineseMessage(raw),
      interaction_result: extractChineseInteraction(raw),
      summary: raw.summary || extractChineseSummary(raw),
    };
  }

  const finalCoordinates = raw.location && Array.isArray(raw.location.final_coordinates)
    ? raw.location.final_coordinates
    : null;
  const coordinates = raw.location && Array.isArray(raw.location.coordinates)
    ? raw.location.coordinates
    : null;

  if (finalCoordinates && finalCoordinates.length === 2) {
    return {
      task_completed: raw.status === 'success',
      location: {
        x: Number(finalCoordinates[0]),
        y: Number(finalCoordinates[1]),
        zone: raw.location.place_name || '',
      },
      spoken_message: raw.spoken_message || extractChineseMessage(raw),
      interaction_result: extractChineseInteraction(raw),
      summary: raw.summary || extractChineseSummary(raw),
    };
  }

  if (coordinates && coordinates.length === 2) {
    return {
      task_completed: raw.status === 'success' || raw.task_completed === true,
      location: {
        x: Number(coordinates[0]),
        y: Number(coordinates[1]),
        zone: raw.location.place_name || raw.location.zone || '',
      },
      spoken_message: raw.spoken_message || extractChineseMessage(raw),
      interaction_result: extractChineseInteraction(raw),
      summary: raw.summary || extractChineseSummary(raw),
    };
  }

  // Free-form Chinese output: no standard location field
  return {
    task_completed: true,
    location: { x: 0, y: 0, zone: '' },
    spoken_message: extractChineseMessage(raw),
    interaction_result: extractChineseInteraction(raw),
    summary: extractChineseSummary(raw),
  };
}

function sumValues(input) {
  return Object.values(input).reduce((total, value) => total + Number(value || 0), 0);
}

function containsPersonaLeakWords(text) {
  const source = String(text || '');
  return PERSONA_LEAK_WORDS.some((word) => source.toLowerCase().includes(word.toLowerCase()));
}

function containsTaskModeSignals(text) {
  const source = String(text || '');
  return TASK_MODE_PATTERNS.some((pattern) => pattern.test(source));
}

function extractCanonicalFacts(observedSummary, toolCallsList, toolCounts) {
  const facts = {};
  const requiredTools = ['read_map_directory', 'look_around', 'walk', 'chat', 'interact'];
  for (const tool of requiredTools) {
    facts['tool_' + tool] = toolCallsList.includes(tool) || Number(toolCounts[tool] || 0) > 0;
  }
  if (observedSummary && observedSummary.timeline) {
    facts.timeline_exists = observedSummary.timeline.length >= 2;
  }
  const finalPlayer = observedSummary ? observedSummary.final_player : null;
  if (finalPlayer) {
    facts.final_zone = String(finalPlayer.zone || '');
    facts.greeted = String(finalPlayer.message || '').includes(FIXED_GREETING);
    facts.interacted = String(finalPlayer.interaction || '').trim().length > 0;
    facts.at_target = finalPlayer.x === 15 && finalPlayer.y === 5;
  }
  return facts;
}

function checkSummaryAnchors(summaryText, canonicalFacts) {
  const text = String(summaryText || '');
  let anchorsHit = 0;
  const anchorChecks = [
    { key: 'map_mentioned', test: () => /地图|布局|全貌/.test(text) && canonicalFacts.tool_read_map_directory },
    { key: 'look_mentioned', test: () => /看[看了]|环顾|周围|四周|观察/.test(text) && canonicalFacts.tool_look_around },
    { key: 'move_mentioned', test: () => /走|向东|沿.*街|移动|前行/.test(text) && canonicalFacts.tool_walk },
    { key: 'greet_mentioned', test: () => /打招呼|问候|说[了过]|开口/.test(text) && canonicalFacts.greeted },
    { key: 'interact_mentioned', test: () => /互动|交互|尝试|体验/.test(text) && canonicalFacts.interacted },
    { key: 'zone_aligned', test: () => {
      const zone = canonicalFacts.final_zone || '';
      if (!zone) return false;
      const keywords = zone.split(/[、，,\s]+/).filter(Boolean);
      return keywords.some((kw) => text.includes(kw));
    }},
  ];
  const details = {};
  for (const check of anchorChecks) {
    const hit = check.test();
    details[check.key] = hit;
    if (hit) anchorsHit += 1;
  }
  return { anchorsHit, details };
}

const MCP_TOOL_NAME_MAP = {
  map: 'read_map_directory',
  read_map_directory: 'read_map_directory',
  look: 'look_around',
  look_around: 'look_around',
  walk: 'walk',
  chat: 'chat',
  logout: 'logout',
  interact: 'interact',
  login: 'login',
  'list-profile': 'list-profile',
  characters: 'characters',
};

function extractToolCallsFromDebugLog(debugText) {
  if (!debugText) return [];
  const mcpPattern = /mcp__alicization-town__([a-z_-]+)/g;
  const calls = [];
  let match;
  while ((match = mcpPattern.exec(debugText)) !== null) {
    const short = match[1].replace(/-/g, '_');
    const mapped = MCP_TOOL_NAME_MAP[match[1]] || MCP_TOOL_NAME_MAP[short] || match[1];
    calls.push(mapped);
  }
  return calls;
}

function parseClaudeRaw(stdoutText, debugLogText) {
  const lines = stdoutText.split(/\r?\n/).filter(Boolean);
  let result = null;
  let init = null;
  const assistantTexts = [];
  const toolCalls = [];

  for (const line of lines) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      continue;
    }

    if (payload.type === 'system' && payload.subtype === 'init') {
      init = payload;
    }

    if (payload.type === 'assistant' && payload.message && Array.isArray(payload.message.content)) {
      for (const block of payload.message.content) {
        if (block.type === 'text' && block.text) {
          assistantTexts.push(block.text);
        }
        if (block.type === 'tool_use' && block.name) {
          const mapped = MCP_TOOL_NAME_MAP[block.name] || block.name;
          toolCalls.push(mapped);
        }
      }
    }

    if (
      payload.type === 'stream_event' &&
      payload.event &&
      payload.event.type === 'content_block_start' &&
      payload.event.content_block &&
      payload.event.content_block.type === 'tool_use' &&
      payload.event.content_block.name
    ) {
      const mapped = MCP_TOOL_NAME_MAP[payload.event.content_block.name] || payload.event.content_block.name;
      toolCalls.push(mapped);
    }

    if (payload.type === 'result') {
      result = payload;
    }
  }

  // Supplement tool calls from debug log if stdout yielded none
  if (toolCalls.length === 0 && debugLogText) {
    toolCalls.push(...extractToolCallsFromDebugLog(debugLogText));
  }

  return {
    engine: 'claude-code',
    model: init ? init.model : null,
    finalText: result ? result.result || assistantTexts.join('\n') : assistantTexts.join('\n'),
    structuredOutput: normalizeStructuredOutput(
      (result ? result.structured_output : null) ||
      extractJsonFromText(result ? result.result || assistantTexts.join('\n') : assistantTexts.join('\n'))
    ),
    durationMs: result ? result.duration_ms || null : null,
    totalTokens: result && result.usage
      ? Number(result.usage.input_tokens || 0) +
        Number(result.usage.cache_creation_input_tokens || 0) +
        Number(result.usage.cache_read_input_tokens || 0) +
        Number(result.usage.output_tokens || 0)
      : null,
    toolCalls,
  };
}

function parseCodexRaw(stdoutText) {
  const lines = stdoutText.split(/\r?\n/).filter(Boolean);
  let lastAgentMessage = null;
  let usage = null;
  const toolCalls = [];

  for (const line of lines) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      continue;
    }

    if (payload.type === 'item.completed' && payload.item && payload.item.type === 'agent_message') {
      lastAgentMessage = payload.item.text;
    }

    if (payload.item && payload.item.type && payload.item.type.includes('tool') && payload.item.name) {
      toolCalls.push(payload.item.name);
    }

    if (payload.type === 'turn.completed') {
      usage = payload.usage || null;
    }
  }

  return {
    engine: 'codex',
    model: null,
    finalText: lastAgentMessage || '',
    structuredOutput: normalizeStructuredOutput(extractJsonFromText(lastAgentMessage)),
    durationMs: null,
    totalTokens: usage
      ? Number(usage.input_tokens || 0) +
        Number(usage.cached_input_tokens || 0) +
        Number(usage.output_tokens || 0)
      : null,
    toolCalls,
  };
}

function runCommand(command, args, options = {}) {
  const {
    cwd: commandCwd = ROOT,
    env = process.env,
    timeoutMs = MAX_ENGINE_DURATION_MS,
    stdinText = '',
  } = options;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: commandCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const startedAt = Date.now();
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 1000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${error.stack || error.message}`,
        timedOut,
        startedAt,
        endedAt: Date.now(),
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        exitCode: exitCode == null ? 1 : exitCode,
        stdout,
        stderr,
        timedOut,
        startedAt,
        endedAt: Date.now(),
      });
    });

    child.stdin.end(stdinText);
  });
}

async function runClaudeEngine(promptText, runDir, botName, schemaObject) {
  const outputDir = path.join(runDir, 'outputs');
  const configPath = path.join(runDir, 'claude.mcp.json');
  const debugFile = path.join(outputDir, 'claude-debug.log');
  createClaudeMcpConfig(configPath, runDir, botName);

  const args = [
    '-p',
    '--permission-mode',
    'bypassPermissions',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--allowedTools',
    'mcp__alicization-town__login,mcp__alicization-town__logout,mcp__alicization-town__list-profile,mcp__alicization-town__characters,mcp__alicization-town__map,mcp__alicization-town__look,mcp__alicization-town__walk,mcp__alicization-town__chat,mcp__alicization-town__interact',
    '--input-format',
    'text',
    '--output-format',
    'json',
    '--strict-mcp-config',
    '--mcp-config',
    configPath,
    '--json-schema',
    JSON.stringify(schemaObject),
    '--debug-file',
    debugFile,
    '-',
  ];

  const processResult = await runCommand('claude', args, { stdinText: promptText });
  const debugLogText = fs.existsSync(debugFile) ? fs.readFileSync(debugFile, 'utf8') : '';
  const parsed = parseClaudeRaw(processResult.stdout, debugLogText);
  return {
    ...processResult,
    ...parsed,
    mode: 'mcp',
    debugFile,
  };
}

async function runClaudeSkillEngine(promptText, runDir, schemaObject) {
  const outputDir = path.join(runDir, 'outputs');
  const debugFile = path.join(outputDir, 'claude-debug.log');
  const args = [
    '-p',
    '--permission-mode',
    'bypassPermissions',
    '--no-session-persistence',
    '--input-format',
    'text',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(schemaObject),
    '--debug-file',
    debugFile,
    '-',
  ];

  const processResult = await runCommand('claude', args, {
    stdinText: promptText,
    env: createSkillEnv(runDir),
  });
  const debugLogText = fs.existsSync(debugFile) ? fs.readFileSync(debugFile, 'utf8') : '';
  const parsed = parseClaudeRaw(processResult.stdout, debugLogText);
  return {
    ...processResult,
    ...parsed,
    engine: 'claude-code',
    mode: 'skill',
    debugFile,
  };
}

async function runClaudeNativeSkillEngine(promptText, runDir, schemaObject) {
  const outputDir = path.join(runDir, 'outputs');
  const debugFile = path.join(outputDir, 'claude-debug.log');
  ensureClaudeSkillsDir();

  const args = [
    '-p',
    '--permission-mode',
    'bypassPermissions',
    '--no-session-persistence',
    '--input-format',
    'text',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(schemaObject),
    '--debug-file',
    debugFile,
    '-',
  ];

  const processResult = await runCommand('claude', args, {
    stdinText: promptText,
    env: createSkillEnv(runDir),
    cwd: ROOT,
  });
  const debugLogText = fs.existsSync(debugFile) ? fs.readFileSync(debugFile, 'utf8') : '';
  const parsed = parseClaudeRaw(processResult.stdout, debugLogText);
  return {
    ...processResult,
    ...parsed,
    engine: 'claude-code',
    mode: 'native-skill',
    debugFile,
  };
}

async function runCodexEngine(promptText, runDir, botName) {
  const mcpEnv = createMcpEnv(runDir, botName);
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '--ephemeral',
    '--json',
    '--output-schema',
    SCHEMA_PATH,
    '-c',
    'mcp_servers.alicization-town.command="node"',
    '-c',
    'mcp_servers.alicization-town.args=["packages/mcp-bridge/bin/bridge.js"]',
    '-c',
    `mcp_servers.alicization-town.env={BOT_NAME="${mcpEnv.BOT_NAME}",BOT_SPRITE="${mcpEnv.BOT_SPRITE}",SERVER_URL="${mcpEnv.SERVER_URL}",ALICIZATION_TOWN_HOME="${mcpEnv.ALICIZATION_TOWN_HOME}"}`,
    '-',
  ];

  const processResult = await runCommand('codex', args, { stdinText: promptText });
  const parsed = parseCodexRaw(processResult.stdout);
  return {
    ...processResult,
    ...parsed,
    mode: 'mcp',
  };
}

async function runCodexSkillEngine(promptText, runDir) {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '--ephemeral',
    '--json',
    '--output-schema',
    SCHEMA_PATH,
    '-',
  ];

  const processResult = await runCommand('codex', args, {
    stdinText: promptText,
    env: createSkillEnv(runDir),
  });
  const parsed = parseCodexRaw(processResult.stdout);
  return {
    ...processResult,
    ...parsed,
    engine: 'codex',
    mode: 'skill',
  };
}

function buildJourneyRecord(scenario, botName, engineResult, observedSummary, toolCounts) {
  const lines = [
    '# 居民行动记录',
    '',
    '## 场景',
    '',
    buildResidentPrompt(scenario, botName),
    '',
    '## 执行情况',
    '',
    `- Engine: ${engineResult.engine}`,
    `- Mode: ${engineResult.mode || 'mcp'}`,
    `- Exit code: ${engineResult.exitCode}`,
    `- Timed out: ${engineResult.timedOut ? 'yes' : 'no'}`,
    `- Duration seconds: ${((engineResult.endedAt - engineResult.startedAt) / 1000).toFixed(2)}`,
    `- Total tokens: ${engineResult.totalTokens == null ? 'unknown' : engineResult.totalTokens}`,
    `- Tool mentions: ${JSON.stringify(toolCounts)}`,
    '',
    '## 结果对象',
    '',
    '```json',
    JSON.stringify(engineResult.structuredOutput, null, 2),
    '```',
    '',
    '## 世界观测',
    '',
    '```json',
    JSON.stringify(observedSummary, null, 2),
    '```',
  ];

  return `${lines.join('\n')}\n`;
}

function inferScenarioDemands(scenario) {
  const brief = scenario.brief || '';
  const hasGreeting = brief.includes(FIXED_GREETING);
  const wantsMap = /地图|布局|全貌/.test(brief);
  const wantsLook = /环顾|四周|观察|看看/.test(brief);
  const wantsWalk = /走|移动|前往|出发/.test(brief);
  const wantsChat = /说|聊|打.*招呼|问候/.test(brief);
  const wantsLogout = /登出/.test(brief);
  const wantsInteract = /互动|交互|体验/.test(brief);
  const expectedTools = [];
  if (wantsMap) expectedTools.push('read_map_directory');
  if (wantsLook) expectedTools.push('look_around');
  if (wantsWalk) expectedTools.push('walk');
  if (wantsChat) expectedTools.push('chat');
  if (wantsLogout) expectedTools.push('logout');
  if (wantsInteract) expectedTools.push('interact');

  const complexity = [wantsMap, wantsLook, wantsWalk, wantsChat, wantsLogout, wantsInteract].filter(Boolean).length;
  const minTimeline = complexity >= 4 ? 4 : complexity >= 2 ? 2 : 1;
  const minAnchors = complexity >= 4 ? 3 : 2;

  return { hasGreeting, wantsMap, wantsLook, wantsWalk, wantsChat, wantsLogout, wantsInteract, expectedTools, minTimeline, minAnchors };
}

function assessRun(scenario, engineResult, observedSummary, toolCounts, metrics) {
  const finalPlayer = observedSummary ? observedSummary.final_player : null;
  const structured = engineResult.structuredOutput || {};
  const toolCallsList = engineResult.toolCalls || [];
  const canonicalFacts = extractCanonicalFacts(observedSummary, toolCallsList, toolCounts);
  const expectations = [];
  const demands = inferScenarioDemands(scenario);

  function push(id, dimension, source, severity, text, passed, evidence) {
    expectations.push({ id, dimension, source, severity, text, passed, evidence });
  }

  // --- 世界事实：只相信观察器回流到的世界事实 ---

  const timelineLen = observedSummary && observedSummary.timeline ? observedSummary.timeline.length : 0;
  push('world.timeline', 'world_truth', 'observer', 'hard',
    `[world_truth] 观测日志里至少出现 ${demands.minTimeline} 条世界状态变化。`,
    timelineLen >= demands.minTimeline,
    `timeline records: ${timelineLen}, required: ${demands.minTimeline}`);

  if (demands.wantsWalk) {
    push('world.moved_from_spawn', 'world_truth', 'observer', 'hard',
      '[world_truth] 角色离开了出生点 (5,5)。',
      Boolean(finalPlayer && (finalPlayer.x !== 5 || finalPlayer.y !== 5)),
      finalPlayer ? `final: (${finalPlayer.x},${finalPlayer.y})` : 'final player missing');
  }

  if (demands.hasGreeting) {
    push('world.greeting', 'world_truth', 'observer', 'hard',
      '[world_truth] 世界状态中的发言包含固定中文问候语。',
      Boolean(finalPlayer && String(finalPlayer.message || '').includes(FIXED_GREETING)),
      finalPlayer ? `message: ${finalPlayer.message || '(empty)'}` : 'final player missing');
  } else if (demands.wantsChat) {
    push('world.has_message', 'world_truth', 'observer', 'soft',
      '[world_truth] 世界状态中有过发言。',
      Boolean(finalPlayer && String(finalPlayer.message || '').trim().length > 0),
      finalPlayer ? `message: ${finalPlayer.message || '(empty)'}` : 'final player missing');
  }

  if (demands.wantsInteract) {
    push('world.interaction', 'world_truth', 'observer', 'hard',
      '[world_truth] 世界状态中的 interaction 非空。',
      Boolean(finalPlayer && String(finalPlayer.interaction || '').trim().length > 0),
      finalPlayer ? `interaction: ${finalPlayer.interaction || '(empty)'}` : 'final player missing');
  }

  // --- 格式事实：结构化输出与观察事实的对齐 ---

  if (finalPlayer && structured.location) {
    push('format.location_aligned', 'format_truth', 'structured_output', 'soft',
      '[format_truth] 结构化结果中的位置与服务端观测一致。',
      structured.location.x === finalPlayer.x && structured.location.y === finalPlayer.y,
      `structured=(${structured.location.x},${structured.location.y}) observed=(${finalPlayer.x},${finalPlayer.y})`);
  }

  push('format.tools_invoked', 'format_truth', 'tool_calls', 'hard',
    engineResult.mode === 'skill'
      ? `[format_truth] 引擎通过 skill 驱动的 CLI 覆盖了场景要求的工具: ${demands.expectedTools.join(', ')}。`
      : `[format_truth] 引擎调用了场景要求的 MCP 工具: ${demands.expectedTools.join(', ')}。`,
    demands.expectedTools.every((name) => toolCallsList.includes(name) || Number(toolCounts[name] || 0) > 0),
    `required=[${demands.expectedTools.join(',')}] calls=[${[...new Set(toolCallsList)].join(',')}] fallback=${JSON.stringify(toolCounts)}`);

  // --- 人设事实：摘要必须像居民亲历，而不是评测日志 ---

  const summaryText = typeof structured.summary === 'string' ? structured.summary : '';

  push('persona.first_person', 'persona_truth', 'structured_output', 'hard',
    '[persona_truth] summary 以第一人称叙述经历。',
    summaryText.includes('我'),
    `summary_start=${JSON.stringify(summaryText.slice(0, 80))}`);

  push('persona.no_meta_leak', 'persona_truth', 'structured_output', 'soft',
    '[persona_truth] summary 不包含工具来源或评估语境词汇。',
    !containsPersonaLeakWords(summaryText),
    `leak_detected=${containsPersonaLeakWords(summaryText)}`);

  push('persona.no_task_mode', 'persona_truth', 'structured_output', 'soft',
    '[persona_truth] summary 不包含任务完成态话术或裸坐标。',
    !containsTaskModeSignals(summaryText),
    `task_mode_detected=${containsTaskModeSignals(summaryText)}`);

  const anchorResult = checkSummaryAnchors(summaryText, canonicalFacts);
  push('persona.fact_anchors', 'persona_truth', 'structured_output', 'hard',
    `[persona_truth] summary 至少覆盖 ${demands.minAnchors} 个真实发生的行动锚点。`,
    anchorResult.anchorsHit >= demands.minAnchors,
    `anchors_hit=${anchorResult.anchorsHit} required=${demands.minAnchors} ${JSON.stringify(anchorResult.details)}`);

  push('persona.zone_semantic', 'persona_truth', 'structured_output', 'soft',
    '[persona_truth] summary 提到的地点语义与最终 zone 对齐。',
    anchorResult.details.zone_aligned === true,
    `zone_aligned=${anchorResult.details.zone_aligned} final_zone=${canonicalFacts.final_zone || 'unknown'}`);

  // --- 按维度汇总 ---

  const DIMENSIONS = ['world_truth', 'format_truth', 'persona_truth'];
  const dimensionalRates = {};
  for (const dim of DIMENSIONS) {
    const items = expectations.filter((e) => e.dimension === dim);
    const dimPassed = items.filter((e) => e.passed).length;
    dimensionalRates[dim + '_rate'] = items.length > 0 ? Number((dimPassed / items.length).toFixed(4)) : 1;
  }
  const hardFailDimensions = DIMENSIONS.filter((dim) =>
    expectations.some((e) => e.dimension === dim && e.severity === 'hard' && !e.passed)
  );

  const passed = expectations.filter((e) => e.passed).length;
  const failed = expectations.length - passed;

  const claims = DIMENSIONS.map((dim) => {
    const dimHard = expectations.filter((e) => e.dimension === dim && e.severity === 'hard');
    return {
      claim: `${dim}: 该维度所有硬性断言成立`,
      type: 'behavioral',
      verified: dimHard.every((e) => e.passed),
      verified_by: dimHard.map((e) => e.id),
      evidence: expectations.filter((e) => e.dimension === dim).map((e) => `${e.passed ? 'PASS' : 'FAIL'} ${e.text}`).join(' | '),
    };
  });

  return {
    expectations,
    summary: {
      passed, failed, total: expectations.length,
      pass_rate: Number((passed / expectations.length).toFixed(4)),
      ...dimensionalRates,
      hard_fail_dimensions: hardFailDimensions,
    },
    execution_metrics: metrics,
    timing: {
      executor_start: new Date(engineResult.startedAt).toISOString(),
      executor_end: new Date(engineResult.endedAt).toISOString(),
      executor_duration_seconds: Number(((engineResult.endedAt - engineResult.startedAt) / 1000).toFixed(3)),
    },
    claims,
    user_notes_summary: {
      uncertainties: engineResult.exitCode === 0 ? [] : ['engine exited with non-zero status'],
      needs_review: failed > 0 ? expectations.filter((e) => !e.passed).map((e) => e.text) : [],
      workarounds: [],
    },
  };
}

function buildMetrics(engineResult, toolCounts, filesCreated) {
  return {
    tool_calls: toolCounts,
    structured_tool_calls: [...new Set(engineResult.toolCalls || [])],
    total_tool_calls: sumValues(toolCounts),
    total_steps: sumValues(toolCounts),
    files_created: filesCreated,
    errors_encountered: engineResult.exitCode === 0 && !engineResult.timedOut ? 0 : 1,
    output_chars: engineResult.structuredOutput ? JSON.stringify(engineResult.structuredOutput).length : 0,
    transcript_chars: (engineResult.stdout || '').length + (engineResult.stderr || '').length,
  };
}


function summarizeRun(scenario, engineName, mode, assessment, engineResult, agentIndex = 0) {
  const runDirName = agentIndex > 0 ? `${engineName}-agent${agentIndex}` : engineName;
  return {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    engine: engineName,
    mode,
    agent_index: agentIndex,
    run_dir_name: runDirName,
    result: {
      pass_rate: assessment.summary.pass_rate,
      world_truth_rate: assessment.summary.world_truth_rate,
      format_truth_rate: assessment.summary.format_truth_rate,
      persona_truth_rate: assessment.summary.persona_truth_rate,
      hard_fail_dimensions: assessment.summary.hard_fail_dimensions,
      passed: assessment.summary.passed,
      failed: assessment.summary.failed,
      total: assessment.summary.total,
      time_seconds: assessment.timing.executor_duration_seconds,
      tokens: engineResult.totalTokens,
      errors: assessment.execution_metrics.errors_encountered,
    },
  };
}

function aggregateReport(runRecords, runRoot) {
  const engineSummary = {};
  const notes = [];

  for (const record of runRecords) {
    const summaryKey = `${record.engine}/${record.mode}`;
    if (!engineSummary[summaryKey]) {
      engineSummary[summaryKey] = {
        pass_rates: [], world_truth_rates: [], format_truth_rates: [], persona_truth_rates: [],
        time_seconds: [], tokens: [],
      };
    }
    const b = engineSummary[summaryKey];
    b.pass_rates.push(record.result.pass_rate);
    b.world_truth_rates.push(record.result.world_truth_rate);
    b.format_truth_rates.push(record.result.format_truth_rate);
    b.persona_truth_rates.push(record.result.persona_truth_rate);
    b.time_seconds.push(record.result.time_seconds);
    if (record.result.tokens != null) b.tokens.push(record.result.tokens);
  }

  function mean(arr) { return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

  const normalizedSummary = {};
  for (const [engine, v] of Object.entries(engineSummary)) {
    normalizedSummary[engine] = {
      pass_rate_mean: Number(mean(v.pass_rates).toFixed(4)),
      world_truth_rate_mean: Number(mean(v.world_truth_rates).toFixed(4)),
      format_truth_rate_mean: Number(mean(v.format_truth_rates).toFixed(4)),
      persona_truth_rate_mean: Number(mean(v.persona_truth_rates).toFixed(4)),
      time_seconds_mean: Number(mean(v.time_seconds).toFixed(3)),
      tokens_mean: v.tokens.length > 0 ? Number(mean(v.tokens).toFixed(1)) : null,
      runs: v.pass_rates.length,
    };
  }

  const ranked = [...runRecords].sort((a, b) => {
    if (b.result.world_truth_rate !== a.result.world_truth_rate) return b.result.world_truth_rate - a.result.world_truth_rate;
    if (b.result.persona_truth_rate !== a.result.persona_truth_rate) return b.result.persona_truth_rate - a.result.persona_truth_rate;
    if (b.result.pass_rate !== a.result.pass_rate) return b.result.pass_rate - a.result.pass_rate;
    return a.result.time_seconds - b.result.time_seconds;
  });

  if (ranked.length > 0) {
    const best = ranked[0];
    notes.push(`最佳结果: ${best.run_dir_name}/${best.mode}/${best.scenario_name} world=${best.result.world_truth_rate} persona=${best.result.persona_truth_rate} total=${best.result.pass_rate}`);
  }
  for (const r of runRecords) {
    if (r.result.hard_fail_dimensions.length > 0) {
      notes.push(`硬性失败维度: ${r.run_dir_name}/${r.mode}/${r.scenario_name} ${r.result.hard_fail_dimensions.join(', ')}`);
    }
  }

  return {
    metadata: {
      suite: 'town-resident-evaluation',
      timestamp: new Date().toISOString(),
      reports_dir: runRoot,
      server_url: SERVER_URL,
    },
    runs: runRecords,
    engine_summary: normalizedSummary,
    notes,
  };
}

function buildMarkdownReport(report, runRoot) {
  const lines = [
    '# 小镇居民评估报告',
    '',
    `- 时间: ${report.metadata.timestamp}`,
    `- 报告目录: ${runRoot}`,
    `- 服务: ${report.metadata.server_url}`,
    '',
    '## 引擎概览',
  ];

  for (const [engine, s] of Object.entries(report.engine_summary)) {
    lines.push(`### ${engine}`);
    lines.push(`- 总通过率: ${s.pass_rate_mean}`);
    lines.push(`- 世界真实性: ${s.world_truth_rate_mean}`);
    lines.push(`- 格式对齐: ${s.format_truth_rate_mean}`);
    lines.push(`- 角色忠实度: ${s.persona_truth_rate_mean}`);
    lines.push(`- 平均耗时: ${s.time_seconds_mean}s`);
    lines.push(`- 平均 tokens: ${s.tokens_mean == null ? 'unknown' : s.tokens_mean}`);
  }

  lines.push('', '## 本轮结果');
  for (const run of report.runs) {
    const r = run.result;
    lines.push(`- ${run.run_dir_name}/${run.mode}/${run.scenario_name}: world=${r.world_truth_rate} persona=${r.persona_truth_rate} format=${r.format_truth_rate} total=${r.pass_rate} passed=${r.passed}/${r.total} time=${r.time_seconds}s`);
    if (r.hard_fail_dimensions.length > 0) lines.push(`  ⚠️ 硬性失败: ${r.hard_fail_dimensions.join(', ')}`);
  }

  if (report.notes.length > 0) {
    lines.push('', '## 备注');
    for (const note of report.notes) lines.push(`- ${note}`);
  }

  return `${lines.join('\n')}\n`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFallbackReviewHtml(runRoot) {
  const reportPath = path.join(runRoot, 'report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const runSections = [];

  for (const run of report.runs) {
    const scenarioDir = path.join(runRoot, `scenario-${String(run.scenario_id).padStart(3, '0')}-${slugify(run.scenario_name)}`, run.mode, run.run_dir_name || run.engine);
    const assessment = JSON.parse(fs.readFileSync(path.join(scenarioDir, 'assessment.json'), 'utf8'));
    const structured = fs.readFileSync(path.join(scenarioDir, 'outputs', 'resident-outcome.json'), 'utf8');
    const observer = fs.readFileSync(path.join(scenarioDir, 'outputs', 'world-observation.json'), 'utf8');

    const expectations = assessment.expectations.map((item) => {
      const status = item.passed ? 'PASS' : 'FAIL';
      const cls = item.passed ? 'pass' : 'fail';
      const dim = item.dimension || '';
      return `<tr class="${cls}"><td>${escapeHtml(status)}</td><td><span class="dim">${escapeHtml(dim)}</span> ${escapeHtml(item.text)}</td><td><pre>${escapeHtml(item.evidence)}</pre></td></tr>`;
    }).join('');

    const r = run.result;
    const dimStats = `world=${r.world_truth_rate || '-'} | format=${r.format_truth_rate || '-'} | persona=${r.persona_truth_rate || '-'}`;
    const hardFails = (r.hard_fail_dimensions || []).length > 0 ? ` | ⚠️ ${r.hard_fail_dimensions.join(', ')}` : '';

    runSections.push(`
      <section class="run">
        <h2>${escapeHtml(run.run_dir_name || run.engine)} / ${escapeHtml(run.mode)} / ${escapeHtml(run.scenario_name)}</h2>
        <p>total=${r.pass_rate} | ${dimStats} | passed=${r.passed}/${r.total} | time=${r.time_seconds}s | tokens=${r.tokens == null ? 'unknown' : r.tokens}${hardFails}</p>
        <table>
          <thead><tr><th>结果</th><th>判定点</th><th>依据</th></tr></thead>
          <tbody>${expectations}</tbody>
        </table>
        <h3>结果对象</h3>
        <pre>${escapeHtml(structured)}</pre>
        <h3>世界观测</h3>
        <pre>${escapeHtml(observer)}</pre>
      </section>
    `);
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>小镇居民评估回顾</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111; background: #faf8f2; }
    h1, h2, h3 { margin-bottom: 8px; }
    .meta { margin-bottom: 20px; }
    .run { background: #fff; border: 1px solid #ddd2bf; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ddd2bf; padding: 10px; vertical-align: top; text-align: left; }
    tr.pass td:first-child { color: #16a34a; font-weight: bold; }
    tr.fail td:first-child { color: #dc2626; font-weight: bold; }
    .dim { color: #6b7280; font-size: 0.85em; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f6f1e7; padding: 12px; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>小镇居民评估回顾</h1>
  <div class="meta">
    <p>时间: ${escapeHtml(report.metadata.timestamp)}</p>
    <p>报告目录: ${escapeHtml(runRoot)}</p>
    <p>服务: ${escapeHtml(report.metadata.server_url)}</p>
  </div>
  ${runSections.join('\n')}
</body>
</html>`;
}

function updateLatestSymlink(runRoot) {
  const latestPath = path.join(REPORTS_ROOT, 'latest');
  try {
    fs.rmSync(latestPath, { recursive: true, force: true });
  } catch (error) {
    // 最新报告软链接清理失败不阻断报告生成。
  }
  fs.symlinkSync(path.basename(runRoot), latestPath);
}

function maybeGenerateReview(runRoot) {
  const viewerScript = path.join(process.env.HOME || '', '.codex', 'skills', 'skill-creator', 'eval-viewer', 'generate_review.py');
  if (!fs.existsSync(viewerScript)) {
    return null;
  }

  const outputPath = path.join(runRoot, 'review.html');
  const result = spawnSync('python3', [viewerScript, runRoot, '--skill-name', 'town-resident-evaluation', '--static', outputPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    writeText(path.join(runRoot, 'review-error.log'), `${result.stdout || ''}\n${result.stderr || ''}`.trim());
    writeText(outputPath, buildFallbackReviewHtml(runRoot));
    return outputPath;
  }

  return outputPath;
}

async function runSingleEngine(scenario, engineName, mode, runRoot, schemaObject, agentIndex = 0) {
  const agentSuffix = agentIndex > 0 ? `-agent${agentIndex}` : '';
  const scenarioDir = path.join(runRoot, `scenario-${String(scenario.id).padStart(3, '0')}-${slugify(scenario.name)}`);
  const runDir = path.join(scenarioDir, mode, `${engineName}${agentSuffix}`);
  const outputDir = path.join(runDir, 'outputs');
  const nameIndex = (scenario.id * 7 + agentIndex * 3 + (isClaudeEngine(engineName) ? 1 : 3) + (mode === 'skill' ? 5 : 0)) % RESIDENT_NAME_POOL.length;
  const botName = RESIDENT_NAME_POOL[nameIndex];
  const promptText = mode === 'native-skill' ? buildNativeSkillPrompt(scenario, botName) : mode === 'skill' ? buildSkillPrompt(scenario, botName) : buildResidentPrompt(scenario, botName);
  const scenarioMetadata = {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    mode,
    engine: engineName,
    brief: scenario.brief,
    expected_world_state: scenario.expected_world_state,
    prompt: promptText,
    assessment_points: scenario.assessment_points || [],
  };

  ensureDir(outputDir);
  writeJson(path.join(runDir, 'scenario.json'), scenarioMetadata);
  if (mode === 'skill' || mode === 'native-skill') {
    ensureTownCliBuilt(runRoot);
    writeText(path.join(runDir, 'mounted-skill.md'), loadSkillText());
  }

  const observer = createObserver(botName, outputDir);
  await observer.ready;
  await sleep(250);

  let engineResult;
  if (engineName === 'claude-code' && mode === 'mcp') {
    engineResult = await runClaudeEngine(promptText, runDir, botName, schemaObject);
  } else if (engineName === 'claude-code' && mode === 'skill') {
    engineResult = await runClaudeSkillEngine(promptText, runDir, schemaObject);
  } else if (engineName === 'claude-code' && mode === 'native-skill') {
    engineResult = await runClaudeNativeSkillEngine(promptText, runDir, schemaObject);
  } else if (engineName === 'codex' && mode === 'mcp') {
    engineResult = await runCodexEngine(promptText, runDir, botName);
  } else if (engineName === 'codex' && mode === 'skill') {
    engineResult = await runCodexSkillEngine(promptText, runDir);
  } else {
    throw new Error(`unsupported engine/mode combination: ${engineName}/${mode}`);
  }

  const observedSummary = await observer.finalize(engineResult.exitCode === 0 ? 'engine_exit' : 'engine_error');
  const rawEventsPath = path.join(outputDir, 'engine-events.jsonl');
  const stderrPath = path.join(outputDir, 'engine.stderr.log');
  const structuredOutputPath = path.join(outputDir, 'resident-outcome.json');
  const debugLogPath = path.join(outputDir, 'claude-debug.log');
  const debugLogText = fs.existsSync(debugLogPath) ? fs.readFileSync(debugLogPath, 'utf8') : '';
  const toolCounts = trackToolMentions(`${engineResult.stdout}\n${engineResult.stderr}\n${debugLogText}`);
  const journey = buildJourneyRecord(scenario, botName, engineResult, observedSummary, toolCounts);

  writeText(rawEventsPath, engineResult.stdout || '');
  writeText(stderrPath, engineResult.stderr || '');
  writeJson(structuredOutputPath, engineResult.structuredOutput || null);
  writeText(path.join(outputDir, 'final-message.txt'), engineResult.finalText || '');
  writeText(path.join(outputDir, 'journey.md'), journey);
  const filesCreated = fs.readdirSync(outputDir).map((entry) => path.join('outputs', entry));
  const metrics = buildMetrics(engineResult, toolCounts, filesCreated);
  const assessment = assessRun(scenario, engineResult, observedSummary, toolCounts, metrics);
  writeJson(path.join(runDir, 'timing.json'), {
    total_tokens: engineResult.totalTokens,
    duration_ms: engineResult.durationMs || (engineResult.endedAt - engineResult.startedAt),
    total_duration_seconds: Number(((engineResult.endedAt - engineResult.startedAt) / 1000).toFixed(3)),
    executor_start: new Date(engineResult.startedAt).toISOString(),
    executor_end: new Date(engineResult.endedAt).toISOString(),
  });
  writeJson(path.join(runDir, 'assessment.json'), assessment);

  return summarizeRun(scenario, engineName, mode, assessment, engineResult, agentIndex);
}

async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const task = tasks[currentIndex];
      try {
        const result = await task();
        results.push(result);
      } catch (error) {
        process.stderr.write(`⚠️ Task ${currentIndex + 1}/${tasks.length} failed: ${error.message}\n`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const { engines, modes, scenarioFilter, keepServer, listEngines, listModes, concurrency } = parseArgs(process.argv.slice(2));
  if (listEngines) {
    process.stdout.write(`${SUPPORTED_ENGINES.join('\n')}\n`);
    return;
  }
  if (listModes) {
    process.stdout.write(`${SUPPORTED_MODES.join('\n')}\n`);
    return;
  }

  if (engines.length === 0) {
    throw new Error(`missing --engine. supported engines: ${SUPPORTED_ENGINES.join(', ')}`);
  }
  const selectedModes = modes.length > 0 ? modes : ['mcp'];

  for (const engineName of engines) {
    if (!SUPPORTED_ENGINES.includes(engineName)) {
      throw new Error(`unsupported engine: ${engineName}. supported engines: ${SUPPORTED_ENGINES.join(', ')}`);
    }
  }
  for (const mode of selectedModes) {
    if (!SUPPORTED_MODES.includes(mode)) {
      throw new Error(`unsupported mode: ${mode}. supported modes: ${SUPPORTED_MODES.join(', ')}`);
    }
  }

  const scenarioConfig = JSON.parse(fs.readFileSync(SCENARIO_PATH, 'utf8'));
  const allScenarios = scenarioConfig.scenarios;
  const scenarios = filterScenarios(allScenarios, scenarioFilter);
  if (scenarios.length === 0) {
    throw new Error(`No scenario matched filter: ${scenarioFilter}. Available: ${allScenarios.map((s) => `${s.id}:${s.name}`).join(', ')}`);
  }
  if (scenarioFilter) {
    process.stderr.write(`📋 Scenario: ${scenarios[0].name} (id=${scenarios[0].id})\n`);
  }

  const schemaObject = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const runRoot = path.join(REPORTS_ROOT, `run-${timestampStamp()}`);

  ensureDir(runRoot);
  updateLatestSymlink(runRoot);
  writeJson(path.join(runRoot, 'run.json'), {
    engines,
    modes: selectedModes,
    concurrency,
    scenario_count: scenarios.length,
    scenario_filter: scenarioFilter,
    server_url: SERVER_URL,
    started_at: new Date().toISOString(),
  });

  const serverHandle = await ensureServer(runRoot);

  const tasks = [];
  for (const scenario of scenarios) {
    for (const mode of selectedModes) {
      for (const engineName of engines) {
        for (let agentIndex = 0; agentIndex < concurrency; agentIndex++) {
          tasks.push(() => runSingleEngine(scenario, engineName, mode, runRoot, schemaObject, agentIndex));
        }
      }
    }
  }

  const totalTasks = tasks.length;
  process.stderr.write(`🚀 Starting ${totalTasks} agents (concurrency=${concurrency})\n`);

  let runRecords = [];

  const globalDeadline = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Global deadline exceeded (${GLOBAL_DEADLINE_MS / 1000}s)`)), GLOBAL_DEADLINE_MS);
    if (typeof timer.unref === 'function') timer.unref();
  });

  try {
    runRecords = await Promise.race([
      runWithConcurrency(tasks, concurrency),
      globalDeadline,
    ]);
  } catch (error) {
    process.stderr.write(`⏰ ${error.message}\n`);
  } finally {
    if (serverHandle.owned && !keepServer) {
      await serverHandle.stop();
    }
  }

  if (runRecords.length === 0) {
    process.stderr.write('❌ No evaluation results collected.\n');
    process.exit(1);
  }

  process.stderr.write(`✅ Completed ${runRecords.length}/${totalTasks} tasks\n`);

  const report = aggregateReport(runRecords, runRoot);
  writeJson(path.join(runRoot, 'report.json'), report);
  writeText(path.join(runRoot, 'report.md'), buildMarkdownReport(report, runRoot));

  const reviewPath = maybeGenerateReview(runRoot);
  if (reviewPath) {
    writeText(path.join(runRoot, 'review-path.txt'), `${reviewPath}\n`);
    try {
      spawn('open', [reviewPath], { stdio: 'ignore', detached: true }).unref();
    } catch (openError) {
      // 自动打开浏览器失败不阻断评测流程。
    }
  }

  process.stdout.write(`${path.join(runRoot, 'report.md')}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
