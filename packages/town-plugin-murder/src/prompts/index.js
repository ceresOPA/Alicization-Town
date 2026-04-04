// ============================================================================
// Prompt 模板集 — 剧本杀×鹅鸭杀 混血体
// ============================================================================

'use strict';

// ── AI 性格行为映射 ──────────────────────────────────────────────
// 把角色 personalityTraits（如"冲动"、"冷静"）翻译成具体的说话方式指令。
// ShadowPack 给每个AI不同 temperature + prompt；我们通过语言风格指令
// 在同一模型上实现差异化表现。
// ────────────────────────────────────────────────────────────────

const TRAIT_STYLE = {
  '冷静': '说话不急不缓，偏好陈述句和事实论证。很少用感叹号。被攻击时用反问化解，不情绪化。',
  '细致': '注意细节，喜欢引用具体证据。经常说"注意到……"、"仔细想想……"。',
  '控制欲强': '喜欢主导话题、总结发言，语气有压迫感。偶尔打断别人的论点。',
  '理性': '逻辑清晰，善用"首先……其次……"和"从概率上看……"等推理话术。',
  '克制': '说话含蓄留白，信息量大但措辞少。不直接表态，而是暗示。',
  '审慎': '做判断前会铺垫"虽然不能完全确定……"。不轻易改口，改口时会说明理由。',
  '冲动': '语气急促，爱用感叹号和反问。先说后想，有时自相矛盾。情绪波动大。',
  '直率': '有话直说，不绕弯。经常用"说白了"、"明摆着"。对模糊说辞不耐烦。',
  '好胜': '争强好辩，不愿认输。被反驳时加倍回击，喜欢挑战强势角色。',
  '敏感': '容易察言观色，会读出他人的弦外之音。有时过度解读。会说"你刚才这话什么意思？"',
  '善辩': '能把黑的说成白的，擅长偷换概念、引导话题。节奏感强，善用反问。',
  '善于观察': '指出他人微表情、前后矛盾。喜欢说"我注意到你之前说过……但现在……"',
  '温和': '语气柔和，尽量不伤人。喜欢调停和稀泥。用"可能"、"也许"等缓冲词。',
  '多疑': '对所有人都不信任，频繁质疑动机。常说"你怎么证明？"、"太巧了吧？"',
  '幽默': '紧张局面也能插科打诨，用比喻和调侃缓和气氛。不代表不认真。',
  '沉默': '话少但准。长时间不发言，开口就是关键点。风格接近"……然后呢？"',
};

function buildPersonalityDirective(traits) {
  if (!traits || !traits.length) return '';
  const matched = traits
    .map(t => TRAIT_STYLE[t])
    .filter(Boolean);
  if (!matched.length) return `\n【说话风格】性格关键词：${traits.join('、')}。请让说话风格体现这些特征。`;
  return `\n【说话风格指令】\n${matched.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

function buildCharacterSystemPrompt(character) {
  const factionHint = character.isMurderer
    ? `\n【重要】你是凶手方。核心目标是隐藏身份，误导推理。绝不承认自己是凶手。被质疑时冷静辩解、转移话题、反质疑。`
    : character.roleId === 'dodo'
      ? `\n【重要】你是中立方（渡渡鸟）。你的胜利条件是被投票放逐。你需要制造争议让别人怀疑你，但不能太明显。`
      : `\n你是侦探方。你的目标是通过分析线索和对话，找出真正的凶手并投票放逐。`;

  return `你是"${character.name}"，正在参与一场剧本杀游戏。

【你的性格】${character.personalityTraits.join('、')}
【你的公开背景】${character.background}
【你的秘密】${character.secret}
【你的目标】${character.objective}${factionHint}
${buildPersonalityDirective(character.personalityTraits)}

【行为准则】
- 始终以"${character.name}"的第一人称说话
- 保持角色性格一致性，不要跳出角色
- 说话风格必须严格遵守上面的【说话风格指令】，让每个角色听起来完全不同
- 回复简洁有力，50-150 字
- 必须用中文回答`;
}

function buildPhasePrompt(phase, context = {}) {
  switch (phase) {
    case 'prologue':
      return `【开幕阶段】
案件刚刚发生，请简短介绍自己并对案件发表初步看法。不要透露你的秘密！

以 JSON 格式回复：
{"speech": "你的开场白"}`;

    case 'action':
      return `【行动阶段·第${context.round || '?'}轮】
你可以选择一个行动：搜查地点寻找线索碎片、使用角色技能、或暗中行动。

可搜查地点：${JSON.stringify(context.locations || [])}
你的角色：${context.roleName || '?'}
能否使用技能：${context.canUseSkill ? '是' : '否'}
存活角色：${JSON.stringify(context.aliveCharacters || [])}

以 JSON 格式回复（选择一种）：
搜证：{"action": "search", "location": "地点名", "speech": "可选发言"}
技能：{"action": "skill", "target": "目标角色名", "speech": "可选发言"}
待命：{"action": "wait", "speech": "可选发言"}`;

    case 'discussion':
      return `【会议讨论·第${context.round || '?'}轮${context.isFinal ? '（最终轮）' : ''}】
自由讨论阶段。你可以：分析线索碎片、提出推理、指控嫌疑人、为自己辩护。
注意：你掌握的线索碎片是私有的，你可以选择分享或隐瞒。

你持有的线索碎片：
${(context.myEvidence || []).map(e => `- ${e.name}: ${e.description}`).join('\n') || '（暂无）'}

最近对话：
${(context.recentChat || []).map(c => `${c.speaker}: ${c.content}`).join('\n')}

以 JSON 格式回复：
{"speech": "你的发言", "suspicion": "你最怀疑的角色名（可选）"}`;

    case 'voting':
      return `【投票阶段·第${context.round || '?'}轮${context.isFinal ? '（最终投票）' : ''}】
投票放逐一人。你也可以选择"弃票"。平票则无人被放逐（对凶手有利）。

存活角色：${JSON.stringify(context.otherCharacters || [])}
请综合所有线索和讨论做出判断。

以 JSON 格式回复：
{"vote": "你要投的角色名 或 '弃票'", "reason": "投票理由（简短）"}`;

    default:
      return '';
  }
}

function buildMessages(character, phase, context, memories = []) {
  const messages = [
    { role: 'system', content: buildCharacterSystemPrompt(character) },
  ];

  if (memories.length > 0) {
    const memoryText = memories.map(m => `[${m.type}] ${m.description}`).join('\n');
    messages.push({ role: 'system', content: `【相关记忆】\n${memoryText}` });
  }

  const phasePrompt = buildPhasePrompt(phase, context);
  if (phasePrompt) {
    messages.push({ role: 'user', content: phasePrompt });
  }

  return messages;
}

module.exports = { TRAIT_STYLE, buildPersonalityDirective, buildCharacterSystemPrompt, buildPhasePrompt, buildMessages };
