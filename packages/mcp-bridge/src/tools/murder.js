const definitions = [
  {
    name: 'murder_create',
    description: '创建一局剧本杀游戏（LangGraph 驱动）。可选指定 gameId 与 humanCharacterId。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '自定义游戏ID（可选）' },
        humanCharacterId: { type: 'string', description: '人类玩家扮演的角色ID（可选）' },
      },
    },
    annotations: { title: 'Murder Create', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'murder_step',
    description: '推进剧本杀一回合。若返回 waitingForHuman=true，需使用 murder_input 提交人类输入。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '游戏ID' },
      },
      required: ['gameId'],
    },
    annotations: { title: 'Murder Step', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'murder_status',
    description: '查看当前游戏状态（阶段、证据、投票、最近对话）。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '游戏ID' },
      },
      required: ['gameId'],
    },
    annotations: { title: 'Murder Status', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'murder_input',
    description: '提交人类输入（通用）。input 可是字符串或结构化对象。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '游戏ID' },
        input: { description: '字符串或对象，例如 {"speech":"..."} / {"vote":"林雅"}' },
      },
      required: ['gameId', 'input'],
    },
    annotations: { title: 'Murder Input', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'murder_speak',
    description: '提交人类发言（便捷方法）。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '游戏ID' },
        text: { type: 'string', description: '发言内容' },
      },
      required: ['gameId', 'text'],
    },
    annotations: { title: 'Murder Speak', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'murder_vote',
    description: '提交人类投票（便捷方法）。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '游戏ID' },
        target: { type: 'string', description: '投票对象（角色名）' },
        reason: { type: 'string', description: '投票理由（可选）' },
      },
      required: ['gameId', 'target'],
    },
    annotations: { title: 'Murder Vote', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'murder_search',
    description: '提交人类搜证动作（便捷方法）。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '游戏ID' },
        location: { type: 'string', description: '搜查地点名' },
        speech: { type: 'string', description: '可选发言' },
      },
      required: ['gameId', 'location'],
    },
    annotations: { title: 'Murder Search', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'murder_skill',
    description: '使用角色技能（行动阶段专用）。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '游戏ID' },
        characterId: { type: 'string', description: '使用技能的角色ID' },
        target: { type: 'string', description: '技能目标角色ID' },
        description: { type: 'string', description: '伪证师专用：伪造线索描述' },
      },
      required: ['gameId', 'characterId'],
    },
    annotations: { title: 'Murder Skill', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'murder_kill',
    description: '凶手方尝试击杀目标（行动阶段专用）。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '游戏ID' },
        killerId: { type: 'string', description: '凶手角色ID' },
        targetId: { type: 'string', description: '目标角色ID' },
      },
      required: ['gameId', 'killerId', 'targetId'],
    },
    annotations: { title: 'Murder Kill', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'murder_autorun',
    description: '启动纯 AI 观战模式。创建全 AI 游戏并自动运行到结束，通过 SSE 流实时观看。返回 SSE 订阅地址。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '自定义游戏ID（可选，默认自动生成）' },
      },
    },
    annotations: { title: 'Murder Auto-Run (Spectate)', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

function formatState(state) {
  const lines = [];
  lines.push(`🕵️ 游戏ID: ${state.gameId}`);
  lines.push(`阶段: ${state.phase}`);

  if (Array.isArray(state.killedCharacters) && state.killedCharacters.length > 0) {
    lines.push(`☠️ 已死亡: ${state.killedCharacters.join(', ')}`);
  }
  if (state.protectedCharacterId) {
    lines.push(`🛡️ 本轮保护: ${state.protectedCharacterId}`);
  }
  if (state.silencedCharacterId) {
    lines.push(`🔇 本轮禁言: ${state.silencedCharacterId}`);
  }

  // 玩家持有线索数
  if (state.playerEvidence) {
    const entries = Object.entries(state.playerEvidence);
    if (entries.length > 0) {
      lines.push('🔍 线索持有:');
      for (const [cid, frags] of entries) {
        lines.push(`  ${cid}: ${Array.isArray(frags) ? frags.length : 0}条`);
      }
    }
  }

  if (state.result) {
    const r = state.result;
    const winLabel = r.winner === 'detective' ? '侦探阵营胜利'
      : r.winner === 'killer' ? '凶手阵营胜利'
      : r.winner === 'neutral' ? '渡渡鸟胜利' : r.winner || '未知';
    lines.push(`🏆 结果: ${winLabel}`);
    if (r.summary) lines.push(`  ${r.summary}`);
  }

  if (state.waitingForHuman) {
    lines.push('⏳ 正在等待人类输入');
  }

  const recent = Array.isArray(state.chatLog) ? state.chatLog.slice(-8) : [];
  if (recent.length > 0) {
    lines.push('');
    lines.push('最近对话:');
    for (const msg of recent) {
      const speaker = msg.speaker || msg.characterId || '系统';
      lines.push(`- ${speaker}: ${msg.content || msg.text || ''}`);
    }
  }

  return lines.join('\n');
}

async function handle(name, args, client) {
  if (name === 'murder_create') {
    const { auth, result } = await client.murderCreateGame({
      gameId: args.gameId,
      humanCharacterId: args.humanCharacterId,
    });
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return { content: [{ type: 'text', text: `✅ 已创建游戏\n${formatState(result.state || {})}` }] };
  }

  if (name === 'murder_step') {
    const { auth, result } = await client.murderStep(args.gameId);
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return { content: [{ type: 'text', text: formatState(result.state || {}) }] };
  }

  if (name === 'murder_status') {
    const { auth, result } = await client.murderGetState(args.gameId);
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return { content: [{ type: 'text', text: formatState(result.state || {}) }] };
  }

  if (name === 'murder_input') {
    const { auth, result } = await client.murderSubmitInput(args.gameId, args.input);
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return { content: [{ type: 'text', text: '✅ 已提交输入，请继续调用 murder_step 推进剧情。' }] };
  }

  if (name === 'murder_speak') {
    const { auth, result } = await client.murderSubmitInput(args.gameId, { speech: args.text });
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return { content: [{ type: 'text', text: '✅ 发言已提交，请继续调用 murder_step。' }] };
  }

  if (name === 'murder_vote') {
    const payload = { vote: args.target, reason: args.reason || '人类玩家投票' };
    const { auth, result } = await client.murderSubmitInput(args.gameId, payload);
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return { content: [{ type: 'text', text: '✅ 投票已提交，请继续调用 murder_step。' }] };
  }

  if (name === 'murder_search') {
    const { auth, result } = await client.murderSearchLocation(args.gameId, {
      characterId: args.characterId,
      location: args.location,
    });
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    const found = result.fragment
      ? `发现线索碎片: ${result.fragment.content || result.fragment.fragmentId}`
      : '此处暂无更多线索';
    return { content: [{ type: 'text', text: `🔍 ${found}` }] };
  }

  if (name === 'murder_skill') {
    const { auth, result } = await client.murderUseSkill(args.gameId, {
      characterId: args.characterId,
      target: args.target,
      description: args.description,
    });
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return { content: [{ type: 'text', text: `⚡ ${result.message || '技能已使用'}` }] };
  }

  if (name === 'murder_kill') {
    const { auth, result } = await client.murderAttemptKill(args.gameId, {
      killerId: args.killerId,
      targetId: args.targetId,
    });
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    const msg = result.killed ? `💀 ${args.targetId} 已被击杀` : `🛡️ 击杀被阻止: ${result.reason || '目标受到保护'}`;
    return { content: [{ type: 'text', text: msg }] };
  }

  if (name === 'murder_autorun') {
    const gId = args.gameId || `spectate_${Date.now()}`;
    const { auth, result } = await client.murderAutoRun(gId);
    if (!result) {
      return { content: [{ type: 'text', text: auth?.message || '当前还没有可用 profile，请先 login。' }] };
    }
    return {
      content: [{
        type: 'text',
        text: `🎬 观战游戏已启动: ${gId}\n` +
              `SSE 订阅: /api/plugins/murder/games/${gId}/stream\n` +
              `使用 murder_status 查看结果（游戏结束后）`,
      }],
    };
  }

  return null;
}

module.exports = { definitions, handle };
