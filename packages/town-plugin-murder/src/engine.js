// ============================================================================
// 游戏引擎 — 剧本杀×鹅鸭杀 混血体
// ============================================================================
// 3 轮行动/会议循环 + 7 角色技能 + 证据碎片 + 投票放逐
//
// 游戏循环（每次 step() 推进一个阶段）：
//   prologue → action_r1 → meeting_r1 → action_r2 → meeting_r2
//            → action_r3 → final_vote → revelation → ended
// ============================================================================

'use strict';

const { buildMessages } = require('./prompts');
const { AssociativeMemory } = require('./memory/associative-memory');
const { createLLM } = require('./llm/provider');
const {
  GamePhase, Faction, RoleId, ROLE_DEFS,
  nextPhaseOf, isActionPhase, isMeetingPhase,
  actionRoundNumber, meetingRoundNumber,
  createInitialState,
} = require('./game-state');
const {
  executeSkill, processKillAttempt,
  canUseSkill, resetRoundSkills,
} = require('./skills');

class MurderGameEngine {
  constructor(options = {}) {
    this.options = options;
    this.games = new Map();
    /** @type {Set<string>} 正在 autorun 的 gameId 集合 */
    this._autoRunning = new Set();
  }

  // ========================================================================
  // 公共 API
  // ========================================================================

  async createGame({ gameId, scriptModule, humanCharacterId }) {
    if (!gameId) throw new Error('gameId 不能为空');
    if (this.games.has(gameId)) throw new Error(`游戏已存在: ${gameId}`);

    const script = (scriptModule || require('./scripts/midnight-manor')).MIDNIGHT_MANOR_SCRIPT;

    let llm;
    try {
      llm = await createLLM(this.options.llm || {});
    } catch (err) {
      const isModuleMissing = err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND'
        || /Cannot find module|Cannot find package/i.test(err.message);
      if (isModuleMissing) {
        throw new Error(
          '缺少 LLM provider 包。请先安装：\n' +
          '  npm install @langchain/openai   # 使用 OpenAI/DeepSeek\n' +
          '  npm install @langchain/anthropic # 使用 Claude\n' +
          '并设置环境变量: MURDER_LLM_API_KEY=<your-key>'
        );
      }
      throw err;
    }

    const { characters, roles } = this._buildCharactersAndRoles(script, humanCharacterId);
    const state = createInitialState(gameId, script, characters, roles, humanCharacterId);

    const session = {
      gameId, llm, state,
      memoryByCharacter: this._createCharacterMemories(characters),
      startedAt: Date.now(),
      timeoutMs: this.options.timeoutMs || 5 * 60 * 1000,
      lastHeartbeatAt: Date.now(),
    };

    this.games.set(gameId, session);
    return this._publicState(state);
  }

  async step(gameId, { _internal } = {}) {
    if (!_internal && this._autoRunning.has(gameId)) {
      throw new Error('游戏正在自动运行中（观战模式），请勿手动操作');
    }
    const session = this._getSession(gameId);
    session.lastHeartbeatAt = Date.now();
    this._handleTimeout(session);

    const state = session.state;
    const phase = state.phase;

    if (phase === GamePhase.ENDED) return this._publicState(state);

    if (phase === GamePhase.PROLOGUE) {
      await this._runPrologue(session);
    } else if (isActionPhase(phase)) {
      await this._runActionPhase(session);
    } else if (isMeetingPhase(phase)) {
      if (state.waitingForHuman) return this._publicState(state);
      await this._runMeetingPhase(session);
    } else if (phase === GamePhase.REVELATION) {
      await this._runRevelation(session);
    }

    return this._publicState(state);
  }

  submitHumanInput(gameId, input) {
    if (this._autoRunning.has(gameId)) {
      throw new Error('游戏正在自动运行中（观战模式），请勿手动操作');
    }
    const session = this._getSession(gameId);
    session.state.humanInput = input;
    session.state.waitingForHuman = false;
    session.lastHeartbeatAt = Date.now();
  }

  useSkill(gameId, characterId, action) {
    if (this._autoRunning.has(gameId)) {
      throw new Error('游戏正在自动运行中（观战模式），请勿手动操作');
    }
    const session = this._getSession(gameId);
    const state = session.state;
    if (!isActionPhase(state.phase)) {
      return { success: false, message: '只能在行动阶段使用技能' };
    }
    return executeSkill(state, characterId, action);
  }

  attemptKill(gameId, killerId, targetId) {
    if (this._autoRunning.has(gameId)) {
      throw new Error('游戏正在自动运行中（观战模式），请勿手动操作');
    }
    const session = this._getSession(gameId);
    const state = session.state;
    if (!isActionPhase(state.phase)) {
      return { success: false, message: '只能在行动阶段击杀' };
    }
    const role = state.roles[killerId];
    if (!role || role.faction !== Faction.KILLER) {
      return { success: false, message: '只有凶手方可以击杀' };
    }
    if (state.killedCharacters.some(k => k.characterId === targetId)) {
      return { success: false, message: '目标已死亡' };
    }
    return processKillAttempt(state, killerId, targetId);
  }

  searchLocation(gameId, characterId, locationName) {
    if (this._autoRunning.has(gameId)) {
      throw new Error('游戏正在自动运行中（观战模式），请勿手动操作');
    }
    const session = this._getSession(gameId);
    const state = session.state;
    if (!isActionPhase(state.phase)) {
      return { success: false, message: '只能在行动阶段搜证' };
    }
    return this._searchFragments(state, characterId, locationName);
  }

  getState(gameId) {
    return this._publicState(this._getSession(gameId).state);
  }

  markAutoRunning(gameId) { this._autoRunning.add(gameId); }
  clearAutoRunning(gameId) { this._autoRunning.delete(gameId); }

  // ========================================================================
  // 阶段执行
  // ========================================================================

  async _runPrologue(session) {
    const state = session.state;
    const script = state.script;

    state.chatLog.push(makeLine(null, script.background, state.phase, 0, 'narration'));

    const firstVictim = script.truth.firstVictimId;
    if (firstVictim) {
      const victim = state.characters[firstVictim];
      state.killedCharacters.push({
        characterId: firstVictim,
        killedBy: script.truth.murdererId,
        round: state.phase,
        visible: true,
        timestamp: Date.now(),
      });
      state.chatLog.push(makeLine(null,
        `突发事件：${victim.name} 被发现倒在了现场！案件就此开始……`,
        state.phase, 0, 'shock',
      ));
    }

    for (const character of this._aliveCharacters(state)) {
      const result = await this._aiAct(session, character, 'prologue', {
        recentChat: tail(state.chatLog, 8),
      });
      const speech = result.parsed?.speech || `我是${character.name}……`;
      state.chatLog.push(makeLine(character, speech, state.phase, 0));
    }

    state.phase = nextPhaseOf(state.phase);
  }

  async _runActionPhase(session) {
    const state = session.state;
    const round = actionRoundNumber(state.phase);

    state.protectedCharacterId = null;
    resetRoundSkills(state.roles);

    // 并行收集所有 AI 角色的 LLM 决策，再串行应用到 state（避免竞态）
    const aiCharacters = this._aliveCharacters(state)
      .filter(c => c.id !== state.humanCharacterId);

    const decisions = await Promise.all(
      aiCharacters.map(async (character) => {
        const result = await this._aiAct(session, character, 'action', {
          round,
          locations: state.script.locations.map(l => l.name),
          myEvidence: state.playerEvidence[character.id] || [],
          canUseSkill: canUseSkill(state.roles, character.id),
          roleName: ROLE_DEFS[state.roles[character.id]?.roleId]?.name || '?',
          recentChat: tail(state.chatLog, 10),
          aliveCharacters: this._aliveCharacters(state).map(c => c.name),
        });
        return { character, result };
      })
    );

    // 串行应用决策到 state
    for (const { character, result } of decisions) {
      const action = result.parsed?.action || 'search';
      const target = result.parsed?.target;
      const speech = result.parsed?.speech;

      if (action === 'search' && result.parsed?.location) {
        const searchResult = this._searchFragments(state, character.id, result.parsed.location);
        if (searchResult.success && searchResult.fragment) {
          state.chatLog.push(makeLine(character,
            `我搜查了${result.parsed.location}，发现了一些东西……`,
            state.phase, round, 'discovery'));
        }
        state.actionLog.push({
          characterId: character.id, action: 'search',
          location: result.parsed.location, round, ts: Date.now(),
        });
      }

      if (action === 'skill' && target) {
        const skillResult = executeSkill(state, character.id, { target, description: result.parsed?.description });
        if (skillResult.success && speech) {
          state.chatLog.push(makeLine(character, speech, state.phase, round));
        }
      }

      if (action === 'kill' && target) {
        const targetChar = this._findCharacterByName(state.characters, target);
        if (targetChar && state.roles[character.id]?.faction === Faction.KILLER) {
          processKillAttempt(state, character.id, targetChar.id);
        }
      }

      await this._remember(session, character.id, {
        type: 'action',
        description: `${character.name} 在行动R${round}执行了 ${action}`,
        importance: 6,
      });
    }

    state.phase = nextPhaseOf(state.phase);
  }

  async _runMeetingPhase(session) {
    const state = session.state;
    const round = meetingRoundNumber(state.phase);
    const isFinal = state.phase === GamePhase.FINAL_VOTE;

    const newBodies = state.killedCharacters
      .filter(k => k.visible && k.round === `action_r${round}`)
      .map(k => state.characters[k.characterId]?.name)
      .filter(Boolean);

    if (newBodies.length) {
      state.chatLog.push(makeLine(null,
        `会议召开！发现了新的遇害者：${newBodies.join('、')}`,
        state.phase, round, 'shock'));
    } else {
      state.chatLog.push(makeLine(null,
        `第${round}轮会议召开。`,
        state.phase, round, 'narration'));
    }

    const alive = this._aliveCharacters(state);
    for (const character of alive) {
      if (character.id === state.silencedCharacterId) {
        state.chatLog.push(makeLine(character, '……（被消音，无法发言）', state.phase, round, 'silence'));
        continue;
      }

      const result = await this._actOrHuman(session, character, 'discussion', {
        round,
        isFinal,
        otherCharacters: alive.map(c => c.name),
        recentChat: tail(state.chatLog, 20),
        myEvidence: (state.playerEvidence[character.id] || []).map(fid =>
          state.evidenceFragments.find(f => f.fragmentId === fid)
        ).filter(Boolean),
      }, state);

      if (result.waitingForHuman) {
        state.waitingForHuman = true;
        return;
      }

      const speech = result.parsed?.speech || '我还在思考……';
      state.chatLog.push(makeLine(character, speech, state.phase, round));

      await this._remember(session, character.id, {
        type: 'chat',
        description: `${character.name} 在会议R${round}发言：${speech}`,
        importance: 7,
      });
    }

    await this._runVoting(session, round, isFinal);
    state.silencedCharacterId = null;
  }

  async _runVoting(session, round, isFinal) {
    const state = session.state;
    const alive = this._aliveCharacters(state);

    // 第一轮投票
    const firstResult = await this._collectVotes(session, alive, round, isFinal);
    if (firstResult.waitingForHuman) return;

    let exiled = this._resolveVotes(state, firstResult.votes, alive);

    // 平票 → 重投一次
    if (!exiled) {
      state.chatLog.push(makeLine(null, '投票平局！加时30秒，进行重投……', state.phase, round, 'tension'));
      const retryResult = await this._collectVotes(session, alive, round, isFinal);
      if (retryResult.waitingForHuman) return;
      exiled = this._resolveVotes(state, retryResult.votes, alive);
    }

    if (exiled) {
      const exiledChar = state.characters[exiled];
      const exiledRole = state.roles[exiled];

      if (exiledRole.roleId === RoleId.DODO) {
        state.result = {
          winner: Faction.NEUTRAL,
          exiled,
          summary: `${exiledChar.name}（渡渡鸟）被投出，渡渡鸟获胜！`,
        };
        state.phase = GamePhase.REVELATION;
        return;
      }

      state.killedCharacters.push({
        characterId: exiled,
        killedBy: 'vote',
        round: state.phase,
        visible: true,
        timestamp: Date.now(),
      });
      state.chatLog.push(makeLine(null,
        `投票结果：${exiledChar.name} 被放逐。`,
        state.phase, round, 'dramatic'));

      if (exiledRole.faction === Faction.KILLER && exiledRole.roleId === RoleId.ELIMINATOR) {
        state.result = {
          winner: Faction.DETECTIVE,
          exiled,
          summary: `${exiledChar.name} 是凶手，侦探方胜利！`,
        };
        state.phase = GamePhase.REVELATION;
        return;
      }

      for (const cid of Object.keys(state.accusationHeat)) {
        if (cid === exiled) continue;
        state.accusationHeat[cid] = Math.max(0, (state.accusationHeat[cid] || 0) - 1);
      }
    } else {
      state.chatLog.push(makeLine(null, '投票平局，无人被放逐（凶手方有利）。', state.phase, round, 'tension'));
    }

    const aliveDetectives = this._aliveCharacters(state)
      .filter(c => state.roles[c.id]?.faction === Faction.DETECTIVE);
    if (aliveDetectives.length < 2) {
      state.result = {
        winner: Faction.KILLER,
        summary: '侦探方人数不足，凶手方胜利！',
      };
      state.phase = GamePhase.REVELATION;
      return;
    }

    if (isFinal && !state.result) {
      state.result = {
        winner: Faction.KILLER,
        summary: '三轮投票均未投出凶手，凶手方胜利！',
      };
      state.phase = GamePhase.REVELATION;
      return;
    }

    if (!state.result) {
      state.phase = nextPhaseOf(state.phase);
    }
  }

  async _runRevelation(session) {
    const state = session.state;
    const truth = state.script.truth;
    const murderer = state.characters[truth.murdererId];
    const result = state.result || { winner: '?', summary: '游戏异常结束。' };

    state.chatLog.push(makeLine(null,
      `=== 真相揭晓 ===\n凶手是 ${murderer.name}。\n${truth.summary}\n\n结果：${result.summary}`,
      GamePhase.REVELATION, 0, 'revelation'));

    state.phase = GamePhase.ENDED;
  }

  // ========================================================================
  // 投票结算（含平票处理）
  // ========================================================================

  async _collectVotes(session, alive, round, isFinal) {
    const state = session.state;
    const votes = {};
    const lines = [];

    for (const character of alive) {
      const result = await this._actOrHuman(session, character, 'voting', {
        round,
        isFinal,
        otherCharacters: alive.map(c => c.name),
        recentChat: tail(state.chatLog, 24),
      }, state);

      if (result.waitingForHuman) {
        state.waitingForHuman = true;
        return { waitingForHuman: true, votes: {} };
      }

      const votedName = result.parsed?.vote;
      if (votedName === '弃票' || !votedName) {
        votes[character.id] = null;
        lines.push(makeLine(character, '我选择弃票。', state.phase, round, 'thinking'));
      } else {
        const votedChar = this._findCharacterByName(state.characters, votedName);
        if (votedChar) {
          votes[character.id] = votedChar.id;
          const reason = result.parsed?.reason || '综合判断';
          lines.push(makeLine(character, `我投给 ${votedChar.name}。理由：${reason}`, state.phase, round, 'accusation'));
        } else {
          votes[character.id] = null;
          lines.push(makeLine(character, `弃票（投给了不存在的人"${votedName}"）。`, state.phase, round, 'thinking'));
        }
      }
    }

    state.chatLog.push(...lines);
    state.meetingVotes = votes;
    return { waitingForHuman: false, votes };
  }

  _resolveVotes(state, votes, alive) {
    const counter = new Map();
    for (const votedFor of Object.values(votes)) {
      if (!votedFor) continue;
      counter.set(votedFor, (counter.get(votedFor) || 0) + 1);
    }
    if (counter.size === 0) return null;

    const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length === 1) return sorted[0][0];
    if (sorted[0][1] > sorted[1][1]) return sorted[0][0];

    // 平票 → 跳过（凶手有利）
    return null;
  }

  // ========================================================================
  // 证据碎片搜索
  // ========================================================================

  _searchFragments(state, characterId, locationName) {
    const location = state.script.locations.find(l => l.name === locationName);
    if (!location) return { success: false, message: '地点不存在' };

    const myEvidence = new Set(state.playerEvidence[characterId] || []);
    const candidates = state.evidenceFragments.filter(f =>
      f.locationId === location.id && !myEvidence.has(f.fragmentId)
    );

    if (!candidates.length) return { success: true, message: '这里没有新的线索了。', fragment: null };

    const found = candidates[0];
    if (!state.playerEvidence[characterId]) state.playerEvidence[characterId] = [];
    state.playerEvidence[characterId].push(found.fragmentId);

    return {
      success: true,
      message: `你发现了线索碎片：${found.name} — ${found.description}`,
      fragment: found,
    };
  }

  // ========================================================================
  // AI / Human 决策
  // ========================================================================

  async _actOrHuman(session, character, phase, phaseContext, state) {
    if (character.id === state.humanCharacterId) {
      if (!state.humanInput) return { waitingForHuman: true };
      const parsed = normalizeHumanInput(state.humanInput, phase);
      state.humanInput = null;
      return { waitingForHuman: false, parsed };
    }
    return this._aiAct(session, character, phase, phaseContext);
  }

  async _aiAct(session, character, phase, phaseContext) {
    const memories = await session.memoryByCharacter[character.id].retrieve(
      `${phase} ${JSON.stringify(phaseContext).slice(0, 200)}`,
      { topK: 6 }
    );
    const messages = buildMessages(character, phase, phaseContext, memories);
    const response = await session.llm.invoke(messages);
    const content = extractText(response);
    const parsed = safeParseJson(content) || { speech: content };
    return { waitingForHuman: false, parsed };
  }

  // ========================================================================
  // 辅助方法
  // ========================================================================

  _buildCharactersAndRoles(script, humanCharacterId) {
    const characters = {};
    const roles = {};
    for (const c of script.characters) {
      characters[c.id] = { ...c, isNpc: c.id !== humanCharacterId };
      roles[c.id] = {
        roleId: c.roleId,
        faction: ROLE_DEFS[c.roleId]?.faction || Faction.DETECTIVE,
        skillUsedThisRound: 0,
        totalSkillUses: 0,
      };
    }
    return { characters, roles };
  }

  _aliveCharacters(state) {
    const deadIds = new Set(state.killedCharacters.map(k => k.characterId));
    return Object.values(state.characters).filter(c => !deadIds.has(c.id));
  }

  _findCharacterByName(characters, name) {
    return Object.values(characters).find(c => c.name === name) || null;
  }

  _createCharacterMemories(characters) {
    const map = {};
    for (const c of Object.values(characters)) {
      map[c.id] = new AssociativeMemory();
    }
    return map;
  }

  async _remember(session, characterId, memory) {
    const mem = session.memoryByCharacter[characterId];
    if (mem) await mem.add(memory);
  }

  async _rememberAll(session, memory) {
    await Promise.all(
      Object.values(session.memoryByCharacter).map(m => m.add(memory))
    );
  }

  _publicState(state) {
    return { ...state };
  }

  _getSession(gameId) {
    const session = this.games.get(gameId);
    if (!session) throw new Error(`游戏不存在: ${gameId}`);
    return session;
  }

  _handleTimeout(session) {
    const now = Date.now();
    if (now - session.lastHeartbeatAt <= session.timeoutMs) return;
    const humanId = session.state.humanCharacterId;
    if (!humanId) return;
    session.state.humanCharacterId = null;
    session.state.chatLog.push(makeLine(null,
      '人类玩家超时未响应，系统已切换为 AI 继续推进剧情。',
      session.state.phase, 0, 'narration'));
  }
}

// ── 工具函数 ─────────────────────────────────────────────────────

function safeParseJson(text) {
  if (!text) return null;
  const raw = String(text).trim();
  try { return JSON.parse(raw); } catch (_) { /* fallthrough */ }
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) { try { return JSON.parse(match[1].trim()); } catch (_) { /* noop */ } }
  return null;
}

function extractText(response) {
  const content = response?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(item => (typeof item === 'string' ? item : item?.text || '')).join('\n').trim();
  }
  return String(content || '').trim();
}

function tail(arr, n) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(Math.max(0, arr.length - n));
}

/**
 * 表情/动画关键词映射（前端可据此渲染表情气泡或像素动画）
 * 仅作 hint，非精确情感分析
 */
const EMOTION_KEYWORDS = [
  { keywords: ['怀疑', '可疑', '嫌疑', '不信', '撒谎', '说谎'], emotion: 'suspicious' },
  { keywords: ['反对', '指控', '指名', '投票', '放逐'], emotion: 'accusation' },
  { keywords: ['害怕', '紧张', '不安', '恐惧', '慌'], emotion: 'fear' },
  { keywords: ['生气', '愤怒', '不满', '荒谬', '胡说'], emotion: 'angry' },
  { keywords: ['同意', '赞同', '附议', '支持', '认同'], emotion: 'agree' },
  { keywords: ['悲伤', '遗憾', '可惜', '可怜', '惋惜'], emotion: 'sad' },
  { keywords: ['发现', '线索', '证据', '找到'], emotion: 'discovery' },
  { keywords: ['冷静', '分析', '推理', '思考', '逻辑'], emotion: 'thinking' },
  { keywords: ['无辜', '冤枉', '清白', '不是我', '自证'], emotion: 'innocent' },
];

function inferEmotion(content) {
  if (!content) return 'neutral';
  for (const { keywords, emotion } of EMOTION_KEYWORDS) {
    if (keywords.some(k => content.includes(k))) return emotion;
  }
  return 'neutral';
}

function makeLine(character, content, phase, round, emotion) {
  return {
    speaker: character?.name || '系统',
    characterId: character?.id || 'system',
    content,
    phase,
    round,
    timestamp: Date.now(),
    emotion: emotion || inferEmotion(content),
  };
}

function normalizeHumanInput(input, phase) {
  if (!input) return { speech: '...' };
  if (typeof input === 'string') {
    if (phase === 'voting') return { vote: input, reason: '人类玩家手动投票' };
    return { speech: input };
  }
  return input;
}

module.exports = { MurderGameEngine };
