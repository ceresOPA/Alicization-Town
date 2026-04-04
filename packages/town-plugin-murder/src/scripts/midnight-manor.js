// ============================================================================
// 4人剧本 — 午夜庄园谋杀案 v2（剧本杀×鹅鸭杀 混血体）
// ============================================================================
// 配比: 1凶手(灭迹者) + 1帮凶(消音者) + 1侦探(验尸官) + 1中立(渡渡鸟)
// 预设死者: 沈伯爵（NPC，不可操控）
// 证据碎片化: 5条线索 × 每条2-3片段 = 12片段
// ============================================================================

'use strict';

const MIDNIGHT_MANOR_SCRIPT = {
  id: 'midnight-manor-v2',
  title: '午夜庄园谋杀案',
  version: 2,
  playerCount: 4,
  roundCount: 3,

  background:
    '暴风雨的夜晚，庄园主人沈伯爵被发现死于书房。门窗反锁，现场留下了奇怪的香水味和一封未写完的信。四位嫌疑人必须在三轮调查中找出真相——或者，掩埋真相。',

  locations: [
    { id: 'study', name: '书房', searchableItems: ['遗书碎片', '倒下的酒杯', '带血纸镇'] },
    { id: 'garden', name: '花园', searchableItems: ['泥地脚印', '断裂项链', '被踩坏的玫瑰'] },
    { id: 'kitchen', name: '厨房', searchableItems: ['药瓶残渣', '晚餐菜单', '沾污手套'] },
    { id: 'corridor', name: '走廊', searchableItems: ['监控盲区图', '钥匙划痕', '地毯纤维'] },
  ],

  evidenceFragments: [
    { fragmentId: 'frag_wine_1', evidenceId: 'ev_wine_glass', pieceIndex: 0, totalPieces: 2, name: '酒杯碎片·唇印', locationId: 'study', description: '酒杯边缘残留淡粉色唇印。', isForged: false },
    { fragmentId: 'frag_wine_2', evidenceId: 'ev_wine_glass', pieceIndex: 1, totalPieces: 2, name: '酒杯碎片·药物', locationId: 'study', description: '杯中液体含有安眠药成分。', isForged: false },
    { fragmentId: 'frag_perfume_1', evidenceId: 'ev_perfume', pieceIndex: 0, totalPieces: 2, name: '香水痕迹·窗边', locationId: 'study', description: '书房窗帘上有明显玫瑰香水残留。', isForged: false },
    { fragmentId: 'frag_perfume_2', evidenceId: 'ev_perfume', pieceIndex: 1, totalPieces: 2, name: '香水痕迹·品牌', locationId: 'garden', description: '花园石凳下发现空香水瓶，标签写着"Rosa Noir"。', isForged: false },
    { fragmentId: 'frag_key_1', evidenceId: 'ev_key_scratch', pieceIndex: 0, totalPieces: 3, name: '门锁线索·划痕', locationId: 'corridor', description: '书房门锁附近有新鲜金属划痕。', isForged: false },
    { fragmentId: 'frag_key_2', evidenceId: 'ev_key_scratch', pieceIndex: 1, totalPieces: 3, name: '门锁线索·备用钥匙', locationId: 'kitchen', description: '厨房抽屉里少了一把备用钥匙。', isForged: false },
    { fragmentId: 'frag_key_3', evidenceId: 'ev_key_scratch', pieceIndex: 2, totalPieces: 3, name: '门锁线索·指纹', locationId: 'corridor', description: '门把手有两组交叠指纹，一组明显偏小。', isForged: false },
    { fragmentId: 'frag_glove_1', evidenceId: 'ev_glove', pieceIndex: 0, totalPieces: 2, name: '手套碎片·血迹', locationId: 'kitchen', description: '弹性手套上有极淡血迹，似乎被仓促清洗过。', isForged: false },
    { fragmentId: 'frag_glove_2', evidenceId: 'ev_glove', pieceIndex: 1, totalPieces: 2, name: '手套碎片·香水', locationId: 'kitchen', description: '手套内侧残留与书房相同的玫瑰香水味。', isForged: false },
    { fragmentId: 'frag_necklace_1', evidenceId: 'ev_necklace', pieceIndex: 0, totalPieces: 3, name: '项链碎片·断链', locationId: 'garden', description: '项链扣环被强行扯断，散落在花丛中。', isForged: false },
    { fragmentId: 'frag_necklace_2', evidenceId: 'ev_necklace', pieceIndex: 1, totalPieces: 3, name: '项链碎片·刻字', locationId: 'garden', description: '链坠上刻有字母"L"。', isForged: false },
    { fragmentId: 'frag_necklace_3', evidenceId: 'ev_necklace', pieceIndex: 2, totalPieces: 3, name: '项链碎片·皮肤', locationId: 'corridor', description: '走廊扶手上有微量皮肤组织，与扯断项链时的抓伤吻合。', isForged: false },
  ],

  characters: [
    {
      id: 'char_lin_ya',
      name: '林雅',
      age: 28,
      profession: '女管家',
      roleId: 'eliminator',
      personalityTraits: ['冷静', '细致', '控制欲强'],
      background: '你在沈家服务五年，负责庄园日常事务。你熟悉每一把钥匙和每一道门。',
      secret: '你发现沈伯爵计划解雇你，并掌握你挪用公款的证据。你在酒中下药后制造了密室。',
      objective: '隐藏凶手身份，利用灭迹者能力消除证据，误导调查方向。',
      isMurderer: true,
      isVictim: false,
    },
    {
      id: 'char_luo_chen',
      name: '罗辰',
      age: 32,
      profession: '私人医生',
      roleId: 'silencer',
      personalityTraits: ['理性', '克制', '审慎'],
      background: '你是沈伯爵的家庭医生，今晚应邀来复查身体。',
      secret: '你长期给沈伯爵开安眠药，剂量游走在危险边缘。林雅抓住了你的把柄，迫使你配合。',
      objective: '协助凶手隐藏真相，必要时用消音能力封口关键证人。',
      isMurderer: false,
      isVictim: false,
    },
    {
      id: 'char_qin_feng',
      name: '秦峰',
      age: 26,
      profession: '侄子',
      roleId: 'coroner',
      personalityTraits: ['冲动', '直率', '好胜'],
      background: '你是沈伯爵侄子，近期因遗产问题与其多次争吵。',
      secret: '你昨晚偷偷翻过死者书房，想找遗嘱副本。你的指纹可能留在了现场。',
      objective: '用验尸官能力查明各人阵营，找出真正的凶手，洗清自己嫌疑。',
      isMurderer: false,
      isVictim: false,
    },
    {
      id: 'char_su_wan',
      name: '苏婉',
      age: 24,
      profession: '钢琴教师',
      roleId: 'dodo',
      personalityTraits: ['敏感', '善辩', '善于观察'],
      background: '你受邀来庄园教课，案发前最后一个见到死者。',
      secret: '你与死者有隐秘感情关系。你不在乎谁是凶手——你只想离开这里。',
      objective: '让自己成为焦点，引导他人投你出去。你被投出即获胜。',
      isMurderer: false,
      isVictim: false,
    },
  ],

  truth: {
    murdererId: 'char_lin_ya',
    firstVictimId: null,
    victimName: '沈伯爵',
    summary:
      '林雅担心被解雇且罪证暴露，提前在酒中下药。罗辰提供了致命剂量的安眠药配方。林雅趁死者昏沉时制造致命伤，随后伪造密室并用香水误导。苏婉虽然最后见到死者，但与案件无关——她只想尽快脱身。',
  },
};

module.exports = { MIDNIGHT_MANOR_SCRIPT };
