// ============================================================================
// 技能系统 — 7 角色技能执行逻辑
// ============================================================================

'use strict';

const { RoleId, Faction, ROLE_DEFS } = require('./game-state');

/**
 * 判断角色本轮是否可以使用技能
 */
function canUseSkill(roles, characterId) {
  const role = roles[characterId];
  if (!role) return false;
  const def = ROLE_DEFS[role.roleId];
  if (!def || def.passive) return false;
  if (role.skillUsedThisRound >= def.perRound) return false;
  if (def.maxUses !== Infinity && role.totalSkillUses >= def.maxUses) return false;
  return true;
}

/**
 * 标记技能已使用
 */
function markSkillUsed(roles, characterId) {
  const role = roles[characterId];
  role.skillUsedThisRound += 1;
  role.totalSkillUses += 1;
}

/**
 * 重置所有角色的本轮技能计数
 */
function resetRoundSkills(roles) {
  for (const role of Object.values(roles)) {
    role.skillUsedThisRound = 0;
  }
}

// ── 各角色技能实现 ────────────────────────────────────────────

function executeCoroner(state, userId, targetId) {
  const targetRole = state.roles[targetId];
  const targetChar = state.characters[targetId];
  const label = { detective: '侦探方', killer: '凶手方', neutral: '中立' };
  return {
    skillType: 'coroner',
    success: true,
    privateMessage: `你查验了 ${targetChar.name}，其阵营为：${label[targetRole.faction]}`,
    publicEffect: null,
  };
}

function executeBodyguard(state, userId, targetId) {
  const targetChar = state.characters[targetId];
  state.protectedCharacterId = targetId;
  return {
    skillType: 'bodyguard',
    success: true,
    privateMessage: `你守护了 ${targetChar.name}，本轮其免疫击杀。`,
    publicEffect: null,
  };
}

function executeTracker(state, userId, targetId) {
  const targetChar = state.characters[targetId];
  const lastAction = [...state.actionLog]
    .reverse()
    .find(a => a.characterId === targetId && a.action === 'search');
  const info = lastAction
    ? `上一轮搜查了 ${lastAction.location}`
    : '上一轮没有搜查任何地点';
  return {
    skillType: 'tracker',
    success: true,
    privateMessage: `你跟踪了 ${targetChar.name}，发现其${info}。`,
    publicEffect: null,
  };
}

function executeForger(state, userId, forgedDesc) {
  const fragmentId = `frag_forged_${userId}_${Date.now()}`;
  const fragment = {
    fragmentId,
    evidenceId: `ev_forged_${Date.now()}`,
    pieceIndex: 0,
    totalPieces: 1,
    name: '可疑线索',
    description: forgedDesc || '一条看似重要的线索…',
    locationId: null,
    isForged: true,
    forgedBy: userId,
  };
  state.evidenceFragments.push(fragment);
  if (!state.playerEvidence[userId]) state.playerEvidence[userId] = [];
  state.playerEvidence[userId].push(fragmentId);
  return {
    skillType: 'forger',
    success: true,
    privateMessage: '你伪造了一条假线索。',
    publicEffect: null,
    fragment,
  };
}

function executeSilencer(state, userId, targetId) {
  const targetChar = state.characters[targetId];
  state.silencedCharacterId = targetId;
  return {
    skillType: 'silencer',
    success: true,
    privateMessage: `你对 ${targetChar.name} 使用了消音，其在下轮会议中无法发言。`,
    publicEffect: null,
  };
}

/**
 * 处理击杀尝试（含保镖 / 灭迹者判定）
 */
function processKillAttempt(state, killerId, targetId) {
  if (state.protectedCharacterId === targetId) {
    return { success: false, message: '目标受到保护，击杀失败。', visible: false };
  }
  const killerRole = state.roles[killerId];
  const isEliminator = killerRole.roleId === RoleId.ELIMINATOR;
  const targetChar = state.characters[targetId];

  state.killedCharacters.push({
    characterId: targetId,
    killedBy: killerId,
    round: state.phase,
    visible: !isEliminator,
    timestamp: Date.now(),
  });

  return {
    success: true,
    message: `你击杀了 ${targetChar.name}。`,
    visible: !isEliminator,
  };
}

/**
 * 统一入口：执行主动技能
 */
function executeSkill(state, characterId, action) {
  const role = state.roles[characterId];
  if (!role) return { success: false, message: '无角色信息' };
  if (!canUseSkill(state.roles, characterId)) {
    return { success: false, message: '技能不可用（次数耗尽或本轮已使用）' };
  }

  let result;
  switch (role.roleId) {
    case RoleId.CORONER:
      result = executeCoroner(state, characterId, action.target);
      break;
    case RoleId.BODYGUARD:
      result = executeBodyguard(state, characterId, action.target);
      break;
    case RoleId.TRACKER:
      result = executeTracker(state, characterId, action.target);
      break;
    case RoleId.FORGER:
      result = executeForger(state, characterId, action.description);
      break;
    case RoleId.SILENCER:
      result = executeSilencer(state, characterId, action.target);
      break;
    default:
      return { success: false, message: '该角色无主动技能' };
  }

  if (result.success) markSkillUsed(state.roles, characterId);
  return result;
}

module.exports = {
  canUseSkill,
  resetRoundSkills,
  executeSkill,
  processKillAttempt,
};
