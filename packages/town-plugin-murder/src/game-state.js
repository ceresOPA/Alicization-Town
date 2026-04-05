// ============================================================================
// 游戏状态定义 — 剧本杀×鹅鸭杀 混血体
// ============================================================================
// 游戏循环：开幕 → [行动R1→会议R1] → [行动R2→会议R2] → [行动R3→最终投票] → 揭晓
// ============================================================================

'use strict';

/** 游戏阶段 */
const GamePhase = Object.freeze({
  SETUP: 'setup',
  PROLOGUE: 'prologue',
  ACTION_R1: 'action_r1',
  MEETING_R1: 'meeting_r1',
  ACTION_R2: 'action_r2',
  MEETING_R2: 'meeting_r2',
  ACTION_R3: 'action_r3',
  FINAL_VOTE: 'final_vote',
  REVELATION: 'revelation',
  ENDED: 'ended',
});

/** 阵营 */
const Faction = Object.freeze({
  DETECTIVE: 'detective',
  KILLER: 'killer',
  NEUTRAL: 'neutral',
});

/** 角色 ID */
const RoleId = Object.freeze({
  CORONER: 'coroner',
  BODYGUARD: 'bodyguard',
  TRACKER: 'tracker',
  FORGER: 'forger',
  SILENCER: 'silencer',
  ELIMINATOR: 'eliminator',
  DODO: 'dodo',
});

/** 角色定义表 */
const ROLE_DEFS = Object.freeze({
  [RoleId.CORONER]: {
    id: RoleId.CORONER, name: '验尸官', faction: Faction.DETECTIVE,
    description: '每轮可查验一人阵营', maxUses: Infinity, perRound: 1, passive: false,
  },
  [RoleId.BODYGUARD]: {
    id: RoleId.BODYGUARD, name: '保镖', faction: Faction.DETECTIVE,
    description: '每轮可守护一人免疫击杀', maxUses: Infinity, perRound: 1, passive: false,
  },
  [RoleId.TRACKER]: {
    id: RoleId.TRACKER, name: '跟踪者', faction: Faction.DETECTIVE,
    description: '每轮可查看一人上轮行踪', maxUses: Infinity, perRound: 1, passive: false,
  },
  [RoleId.FORGER]: {
    id: RoleId.FORGER, name: '伪证师', faction: Faction.KILLER,
    description: '伪造假线索碎片（全局限2次）', maxUses: 2, perRound: 1, passive: false,
  },
  [RoleId.SILENCER]: {
    id: RoleId.SILENCER, name: '消音者', faction: Faction.KILLER,
    description: '会议前禁言一人（全局限1次）', maxUses: 1, perRound: 1, passive: false,
  },
  [RoleId.ELIMINATOR]: {
    id: RoleId.ELIMINATOR, name: '灭迹者', faction: Faction.KILLER,
    description: '击杀不留尸体（被动）', maxUses: Infinity, perRound: 0, passive: true,
  },
  [RoleId.DODO]: {
    id: RoleId.DODO, name: '渡渡鸟', faction: Faction.NEUTRAL,
    description: '被放逐即获胜（被动）', maxUses: Infinity, perRound: 0, passive: true,
  },
});

/** 阶段顺序 */
const PHASE_ORDER = [
  GamePhase.PROLOGUE,
  GamePhase.ACTION_R1, GamePhase.MEETING_R1,
  GamePhase.ACTION_R2, GamePhase.MEETING_R2,
  GamePhase.ACTION_R3, GamePhase.FINAL_VOTE,
  GamePhase.REVELATION, GamePhase.ENDED,
];

function nextPhaseOf(current) {
  const idx = PHASE_ORDER.indexOf(current);
  if (idx === -1 || idx >= PHASE_ORDER.length - 1) return GamePhase.ENDED;
  return PHASE_ORDER[idx + 1];
}

function isActionPhase(phase) {
  return phase === GamePhase.ACTION_R1
    || phase === GamePhase.ACTION_R2
    || phase === GamePhase.ACTION_R3;
}

function isMeetingPhase(phase) {
  return phase === GamePhase.MEETING_R1
    || phase === GamePhase.MEETING_R2
    || phase === GamePhase.FINAL_VOTE;
}

function actionRoundNumber(phase) {
  if (phase === GamePhase.ACTION_R1) return 1;
  if (phase === GamePhase.ACTION_R2) return 2;
  if (phase === GamePhase.ACTION_R3) return 3;
  return 0;
}

function meetingRoundNumber(phase) {
  if (phase === GamePhase.MEETING_R1) return 1;
  if (phase === GamePhase.MEETING_R2) return 2;
  if (phase === GamePhase.FINAL_VOTE) return 3;
  return 0;
}

/** 创建初始游戏状态 */
function createInitialState(gameId, script, characters, roles, humanCharacterId) {
  const playerEvidence = {};
  const accusationHeat = {};
  for (const id of Object.keys(characters)) {
    playerEvidence[id] = [];
    accusationHeat[id] = 0;
  }
  return {
    gameId,
    phase: GamePhase.PROLOGUE,
    script,
    characters,
    humanCharacterId,
    roles,
    chatLog: [],
    evidenceFragments: [...(script.evidenceFragments || [])],
    playerEvidence,
    killedCharacters: [],
    protectedCharacterId: null,
    silencedCharacterId: null,
    actionLog: [],
    meetingVotes: {},
    accusationHeat,
    currentSpeaker: null,
    waitingForHuman: false,
    humanInput: null,
    result: null,
  };
}

module.exports = {
  GamePhase,
  Faction,
  RoleId,
  ROLE_DEFS,
  PHASE_ORDER,
  nextPhaseOf,
  isActionPhase,
  isMeetingPhase,
  actionRoundNumber,
  meetingRoundNumber,
  createInitialState,
};
