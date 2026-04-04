const { runAuthenticated, parseFlags } = require('./core');

function throwForAuth(auth) {
  if (!auth) return;
  throw new Error(auth.message || '当前无法执行该操作，请先 login。');
}

function parseSubcommand(args) {
  const [subcommand = 'help', ...rest] = args;
  return { subcommand, rest, flags: parseFlags(rest) };
}

async function murder(args) {
  const { subcommand, flags } = parseSubcommand(args);

  if (subcommand === 'create') {
    const body = {};
    if (flags.game) body.gameId = flags.game;
    if (flags.human) body.humanCharacterId = flags.human;

    const { auth, result } = await runAuthenticated('POST', '/api/plugins/murder/games', body);
    if (!result) throwForAuth(auth);
    console.log(`✅ 已创建游戏: ${result.gameId}`);
    console.log(formatState(result.state));
    return;
  }

  if (subcommand === 'step') {
    const gameId = flags.game || flags.id || flags._[0];
    if (!gameId) throw new Error('用法: town murder step --game <GAME_ID>');

    const { auth, result } = await runAuthenticated('POST', `/api/plugins/murder/games/${encodeURIComponent(gameId)}/step`);
    if (!result) throwForAuth(auth);
    console.log(formatState(result.state));
    return;
  }

  if (subcommand === 'status') {
    const gameId = flags.game || flags.id || flags._[0];
    if (!gameId) throw new Error('用法: town murder status --game <GAME_ID>');

    const { auth, result } = await runAuthenticated('GET', `/api/plugins/murder/games/${encodeURIComponent(gameId)}`);
    if (!result) throwForAuth(auth);
    console.log(formatState(result.state));
    return;
  }

  if (subcommand === 'speak') {
    const gameId = flags.game || flags.id;
    const text = flags.text || flags._.join(' ');
    if (!gameId || !text) throw new Error('用法: town murder speak --game <GAME_ID> --text <发言内容>');

    const { auth, result } = await runAuthenticated(
      'POST',
      `/api/plugins/murder/games/${encodeURIComponent(gameId)}/input`,
      { input: { speech: text } }
    );
    if (!result) throwForAuth(auth);
    console.log('✅ 发言已提交，请执行 town murder step 推进剧情。');
    return;
  }

  if (subcommand === 'vote') {
    const gameId = flags.game || flags.id;
    const target = flags.target || flags._[0];
    const reason = flags.reason || '人类玩家投票';
    if (!gameId || !target) throw new Error('用法: town murder vote --game <GAME_ID> --target <角色名> [--reason <理由>]');

    const { auth, result } = await runAuthenticated(
      'POST',
      `/api/plugins/murder/games/${encodeURIComponent(gameId)}/input`,
      { input: { vote: target, reason } }
    );
    if (!result) throwForAuth(auth);
    console.log('✅ 投票已提交，请执行 town murder step 推进剧情。');
    return;
  }

  if (subcommand === 'search') {
    const gameId = flags.game || flags.id;
    const location = flags.location || flags.at || flags._[0];
    const characterId = flags.character || flags.char;
    if (!gameId || !location) throw new Error('用法: town murder search --game <GAME_ID> --location <地点名> [--character <角色ID>]');

    const body = { location };
    if (characterId) body.characterId = characterId;
    const { auth, result } = await runAuthenticated(
      'POST',
      `/api/plugins/murder/games/${encodeURIComponent(gameId)}/search`,
      body
    );
    if (!result) throwForAuth(auth);
    if (result.fragment) {
      console.log(`🔍 发现线索碎片: ${result.fragment.content || result.fragment.fragmentId}`);
    } else {
      console.log('🔍 此处暂无更多线索');
    }
    return;
  }

  if (subcommand === 'skill') {
    const gameId = flags.game || flags.id;
    const characterId = flags.character || flags.char;
    const target = flags.target || flags._[0];
    const description = flags.desc || flags.description;
    if (!gameId || !characterId) throw new Error('用法: town murder skill --game <GAME_ID> --character <角色ID> [--target <目标ID>] [--desc <描述>]');

    const body = { characterId };
    if (target) body.target = target;
    if (description) body.description = description;
    const { auth, result } = await runAuthenticated(
      'POST',
      `/api/plugins/murder/games/${encodeURIComponent(gameId)}/skill`,
      body
    );
    if (!result) throwForAuth(auth);
    console.log(`⚡ ${result.message || '技能已使用'}`);
    return;
  }

  if (subcommand === 'kill') {
    const gameId = flags.game || flags.id;
    const killerId = flags.killer;
    const targetId = flags.target || flags._[0];
    if (!gameId || !killerId || !targetId) throw new Error('用法: town murder kill --game <GAME_ID> --killer <凶手ID> --target <目标ID>');

    const { auth, result } = await runAuthenticated(
      'POST',
      `/api/plugins/murder/games/${encodeURIComponent(gameId)}/kill`,
      { killerId, targetId }
    );
    if (!result) throwForAuth(auth);
    if (result.killed) {
      console.log(`💀 ${targetId} 已被击杀`);
    } else {
      console.log(`🛡️ 击杀被阻止: ${result.reason || '目标受到保护'}`);
    }
    return;
  }

  if (subcommand === 'input') {
    const gameId = flags.game || flags.id;
    const text = flags.text;
    const jsonRaw = flags.json;
    if (!gameId || (!text && !jsonRaw)) {
      throw new Error('用法: town murder input --game <GAME_ID> --text <文本> | --json <JSON字符串>');
    }

    let input = text;
    if (jsonRaw) {
      try {
        input = JSON.parse(jsonRaw);
      } catch {
        throw new Error('json 参数不是合法 JSON');
      }
    }

    const { auth, result } = await runAuthenticated(
      'POST',
      `/api/plugins/murder/games/${encodeURIComponent(gameId)}/input`,
      { input }
    );
    if (!result) throwForAuth(auth);
    console.log('✅ 输入已提交，请执行 town murder step 推进剧情。');
    return;
  }

  console.log(`用法: town murder <subcommand> [args]

  create [--game <GAME_ID>] [--human <CHARACTER_ID>]
  step --game <GAME_ID>
  status --game <GAME_ID>
  speak --game <GAME_ID> --text <发言>
  vote --game <GAME_ID> --target <角色名> [--reason <理由>]
  search --game <GAME_ID> --location <地点名> [--character <角色ID>]
  skill --game <GAME_ID> --character <角色ID> [--target <目标ID>] [--desc <描述>]
  kill --game <GAME_ID> --killer <凶手ID> --target <目标ID>
  input --game <GAME_ID> --text <文本> | --json <JSON字符串>
`);
}

function formatState(state = {}) {
  const lines = [];
  lines.push(`🕵️ 游戏ID: ${state.gameId || '-'}`);
  lines.push(`阶段: ${state.phase || '-'}`);
  if (Array.isArray(state.killedCharacters) && state.killedCharacters.length > 0) {
    lines.push(`☠️ 已死亡: ${state.killedCharacters.join(', ')}`);
  }
  if (state.playerEvidence) {
    const entries = Object.entries(state.playerEvidence);
    if (entries.length > 0) {
      for (const [cid, frags] of entries) {
        lines.push(`🔍 ${cid}: ${Array.isArray(frags) ? frags.length : 0}条线索`);
      }
    }
  }
  if (state.result) {
    const r = state.result;
    const winLabel = r.winner === 'detective' ? '侦探阵营胜利'
      : r.winner === 'killer' ? '凶手阵营胜利'
      : r.winner === 'neutral' ? '渡渡鸟胜利' : r.winner || '未知';
    lines.push(`🏆 结果: ${winLabel}`);
  }
  if (state.waitingForHuman) {
    lines.push('⏳ 等待人类输入');
  }
  const recent = Array.isArray(state.chatLog) ? state.chatLog.slice(-6) : [];
  if (recent.length > 0) {
    lines.push('');
    lines.push('最近对话:');
    for (const m of recent) {
      const speaker = m.speaker || m.characterId || '系统';
      lines.push(`- ${speaker}: ${m.content || m.text || ''}`);
    }
  }
  return lines.join('\n');
}

module.exports = { murder };
