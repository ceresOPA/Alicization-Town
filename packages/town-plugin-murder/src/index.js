'use strict';

const { IPlugin } = require('@alicization/core-interfaces');
const { WorldEventType } = require('@alicization/core-interfaces/src/events');
const { MurderGameEngine } = require('./engine');

/**
 * 剧本杀插件（LangGraph 版）
 *
 * 提供能力：
 * - HTTP API 路由: 创建/推进/输入/查询游戏
 * - 事件监听: 监听聊天和交互（后续可用于自动触发剧情）
 */
class TownPluginMurder extends IPlugin {
  constructor() {
    super();
    this.id = 'town-plugin-murder';
    this.version = '0.1.0';
    this.compatibleCoreVersion = '^0.6.0';

    this.gameEngine = new MurderGameEngine({
      llm: {
        provider: process.env.MURDER_LLM_PROVIDER,
        model: process.env.MURDER_LLM_MODEL,
        apiKey: process.env.MURDER_LLM_API_KEY,
        baseURL: process.env.MURDER_LLM_BASE_URL,
      },
      timeoutMs: Number(process.env.MURDER_HUMAN_TIMEOUT_MS || 300000),
    });

    /** @type {Map<string, Set<import('http').ServerResponse>>} gameId → SSE clients */
    this._sseClients = new Map();
  }

  async onRegister(ctx) {
    // --------------------------
    // 路由注册
    // 前缀: /api/plugins/murder
    // --------------------------

    ctx.registerRoute({
      method: 'POST',
      path: '/murder/games',
      requireSession: true,
      handler: async (req, res) => {
        try {
          const gameId = req.body?.gameId || `murder_${Date.now()}`;
          const humanCharacterId = req.body?.humanCharacterId || null;

          const state = await this.gameEngine.createGame({ gameId, humanCharacterId });
          return res.status(201).json({ ok: true, gameId, state });
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
      },
    });

    ctx.registerRoute({
      method: 'POST',
      path: '/murder/games/:gameId/step',
      requireSession: true,
      handler: async (req, res) => {
        try {
          const state = await this.gameEngine.step(req.params.gameId);
          this._broadcast(req.params.gameId, { type: 'stateUpdate', state });
          return res.json({ ok: true, state });
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
      },
    });

    ctx.registerRoute({
      method: 'POST',
      path: '/murder/games/:gameId/input',
      requireSession: true,
      handler: async (req, res) => {
        try {
          const input = req.body?.input;
          this.gameEngine.submitHumanInput(req.params.gameId, input);
          return res.json({ ok: true });
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
      },
    });

    ctx.registerRoute({
      method: 'GET',
      path: '/murder/games/:gameId',
      requireSession: true,
      handler: async (req, res) => {
        try {
          const state = this.gameEngine.getState(req.params.gameId);
          return res.json({ ok: true, state });
        } catch (err) {
          return res.status(404).json({ ok: false, error: err.message });
        }
      },
    });

    // ── 行动阶段专用路由 ────────────────────────────────────────

    ctx.registerRoute({
      method: 'POST',
      path: '/murder/games/:gameId/skill',
      requireSession: true,
      handler: async (req, res) => {
        try {
          const { characterId, target, description } = req.body || {};
          const result = this.gameEngine.useSkill(
            req.params.gameId, characterId, { target, description }
          );
          if (result.success) {
            this._broadcast(req.params.gameId, { type: 'skill', characterId, result });
          }
          return res.json({ ok: result.success, ...result });
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
      },
    });

    ctx.registerRoute({
      method: 'POST',
      path: '/murder/games/:gameId/kill',
      requireSession: true,
      handler: async (req, res) => {
        try {
          const { killerId, targetId } = req.body || {};
          const result = this.gameEngine.attemptKill(
            req.params.gameId, killerId, targetId
          );
          if (result.success) {
            this._broadcast(req.params.gameId, { type: 'kill', killerId, result });
          }
          return res.json({ ok: result.success, ...result });
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
      },
    });

    ctx.registerRoute({
      method: 'POST',
      path: '/murder/games/:gameId/search',
      requireSession: true,
      handler: async (req, res) => {
        try {
          const { characterId, location } = req.body || {};
          const result = this.gameEngine.searchLocation(
            req.params.gameId, characterId, location
          );
          if (result.success) {
            this._broadcast(req.params.gameId, { type: 'search', characterId, location, result });
          }
          return res.json({ ok: result.success, ...result });
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
      },
    });

    // ── SSE 实时事件流 ──────────────────────────────────────────

    ctx.registerRoute({
      method: 'GET',
      path: '/murder/games/:gameId/stream',
      requireSession: false,
      handler: (req, res) => {
        const { gameId } = req.params;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ type: 'connected', gameId })}\n\n`);

        if (!this._sseClients.has(gameId)) this._sseClients.set(gameId, new Set());
        this._sseClients.get(gameId).add(res);

        req.on('close', () => {
          const clients = this._sseClients.get(gameId);
          if (clients) {
            clients.delete(res);
            if (clients.size === 0) this._sseClients.delete(gameId);
          }
        });
      },
    });

    // ── 纯 AI 观战模式 ─────────────────────────────────────────
    // POST /murder/games/:gameId/autorun
    // 创建全 AI 游戏并自动跑完全程，SSE 实时推送每阶段状态
    // 参考 wolfcha 的 AI Model Arena 思路

    ctx.registerRoute({
      method: 'POST',
      path: '/murder/games/:gameId/autorun',
      requireSession: true,
      handler: async (req, res) => {
        const { gameId } = req.params;
        try {
          // 创建全 AI 游戏（humanCharacterId = null）
          const initial = await this.gameEngine.createGame({
            gameId,
            humanCharacterId: null,
          });
          this._broadcast(gameId, { type: 'stateUpdate', state: initial });

          // 立即返回，后台自动推进
          res.json({ ok: true, gameId, message: '观战游戏已启动，通过 SSE 订阅实时进度' });

          // 异步自动推进到结束
          this._autoRun(gameId).catch(err => {
            this._broadcast(gameId, { type: 'error', message: err.message });
          });
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
      },
    });

    // --------------------------
    // 事件监听（预留扩展）
    // --------------------------
    ctx.onEvent(WorldEventType.CHAT, async (event) => {
      // 可在此处监听普通世界聊天，自动引导进入剧本杀场景
      // 当前 MVP 不做自动触发，避免侵入主世界逻辑
      void event;
    });

    ctx.onEvent(WorldEventType.INTERACTION, async (event) => {
      // 未来可在玩家 interact 特定 NPC 时触发游戏邀请
      void event;
    });

    console.log('🕵️ 剧本杀插件已注册: /api/plugins/murder/*');
  }

  async onUnregister() {
    // 清理 SSE 连接
    for (const [, clients] of this._sseClients) {
      for (const res of clients) {
        try { res.end(); } catch { /* ignore */ }
      }
    }
    this._sseClients.clear();
  }

  /**
   * 纯 AI 观战：自动推进游戏到结束，每阶段广播状态
   * 在阶段间加入延迟使 SSE 观众能跟上节奏
   */
  async _autoRun(gameId) {
    const { GamePhase } = require('./game-state');
    const PHASE_DELAY_MS = 2000;

    this.gameEngine.markAutoRunning(gameId);
    try {
      let state;
      do {
        state = await this.gameEngine.step(gameId, { _internal: true });
        this._broadcast(gameId, { type: 'stateUpdate', state });
        if (state.phase !== GamePhase.ENDED) {
          await new Promise(r => setTimeout(r, PHASE_DELAY_MS));
        }
      } while (state.phase !== GamePhase.ENDED);

      this._broadcast(gameId, { type: 'gameEnd', result: state.result });
    } finally {
      this.gameEngine.clearAutoRunning(gameId);
    }
  }

  /**
   * 广播游戏事件到 SSE 客户端（视角过滤：隐藏敏感信息）
   *
   * 安全策略：
   * - roles / protectedCharacterId / silencedCharacterId / actionLog / evidenceFragments
   *   全部从广播中剥离，防止通过 DevTools 偷看底牌
   * - playerEvidence 只保留人类玩家自己的
   * - 仅在 REVELATION/ENDED 阶段才广播完整 roles（游戏已结束，无需保密）
   */
  _broadcast(gameId, event) {
    const clients = this._sseClients.get(gameId);
    if (!clients || clients.size === 0) return;
    const safe = this._sanitizeEvent(gameId, event);
    const payload = `data: ${JSON.stringify(safe)}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch { /* ignore dead connections */ }
    }
  }

  /**
   * 从 SSE 事件中剥离敏感字段
   */
  _sanitizeEvent(gameId, event) {
    if (event.type === 'stateUpdate') {
      return this._sanitizeStateEvent(event);
    }
    // skill/kill/search 事件：只广播"发生了什么类型事件"，不暴露具体结果
    // 具体结果通过 HTTP response 只返回给发起请求的玩家
    if (event.type === 'skill' || event.type === 'kill' || event.type === 'search') {
      return { type: event.type, timestamp: Date.now() };
    }
    return event;
  }

  /**
   * 剥离 stateUpdate 中的敏感字段
   */
  _sanitizeStateEvent(event) {
    const state = event.state;
    if (!state) return event;

    const { GamePhase } = require('./game-state');
    const isRevealed = state.phase === GamePhase.REVELATION || state.phase === GamePhase.ENDED;

    // 浅拷贝，剥离敏感字段
    const sanitized = {
      gameId: state.gameId,
      phase: state.phase,
      characters: state.characters,
      humanCharacterId: state.humanCharacterId,
      chatLog: state.chatLog,
      killedCharacters: state.killedCharacters,
      currentSpeaker: state.currentSpeaker,
      waitingForHuman: state.waitingForHuman,
      accusationHeat: state.accusationHeat,
      meetingVotes: state.meetingVotes,
      result: state.result,
    };

    // 游戏结束后才暴露角色信息
    if (isRevealed) {
      sanitized.roles = state.roles;
      sanitized.playerEvidence = state.playerEvidence;
    } else {
      // 仅暴露人类玩家自己的证据
      if (state.humanCharacterId && state.playerEvidence) {
        sanitized.playerEvidence = {
          [state.humanCharacterId]: state.playerEvidence[state.humanCharacterId] || [],
        };
      }
    }

    return { type: 'stateUpdate', state: sanitized };
  }
}

module.exports = TownPluginMurder;
