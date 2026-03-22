// NPC 角色配置
// 定义常驻 NPC 的身份、外观、性格与行为参数

const NPC_PROFILES = [
  {
    id: 'npc_elder_chen',
    name: '村长老陈',
    sprite: 'OldMan',
    personality: 'friendly',
    spawnX: 14,
    spawnY: 12,
    // 行为权重：决定每次行动时选择各动作的概率
    behaviorWeights: { wander: 0.3, chat: 0.4, interact: 0.2, idle: 0.1 },
    // 行动间隔范围（毫秒）
    actionIntervalMin: 4000,
    actionIntervalMax: 8000,
    // 漫步参数
    wanderStepsMin: 1,
    wanderStepsMax: 5,
    // 聊天语料：空闲时随机说的话
    idleChats: [
      '今天天气真不错，适合在小镇逛逛。',
      '欢迎来到 Alicization Town！这里是一个充满可能的地方。',
      '年轻人，多去各处走走看看吧。',
      '听说东边的池塘最近来了不少鱼。',
      '神社那边最近很灵验呢，去许个愿吧。',
      '我在这个小镇住了很多年了，有什么想知道的尽管问。',
      '集市上新来了一批货物，值得去看看。',
    ],
    // 看到附近玩家时的问候语
    greetings: [
      '你好啊，旅行者！初来乍到吧？',
      '嗯？新面孔啊，欢迎欢迎！',
      '哈哈，又有新朋友来了！',
      '路过的朋友，要不要坐下来聊聊？',
    ],
  },
  {
    id: 'npc_samurai_lin',
    name: '武士小林',
    sprite: 'Samurai',
    personality: 'stoic',
    spawnX: 30,
    spawnY: 25,
    behaviorWeights: { wander: 0.5, chat: 0.1, interact: 0.3, idle: 0.1 },
    actionIntervalMin: 3000,
    actionIntervalMax: 6000,
    wanderStepsMin: 2,
    wanderStepsMax: 8,
    idleChats: [
      '……',
      '剑道之要，在于心静。',
      '这附近没有异常。',
      '巡逻是武士的本分。',
      '练习场的木人桩又该换新的了。',
    ],
    greetings: [
      '嗯。',
      '路上小心。',
      '有事吗？',
    ],
  },
  {
    id: 'npc_princess_lily',
    name: '公主莉莉',
    sprite: 'Princess',
    personality: 'curious',
    spawnX: 20,
    spawnY: 8,
    behaviorWeights: { wander: 0.4, chat: 0.3, interact: 0.25, idle: 0.05 },
    actionIntervalMin: 3000,
    actionIntervalMax: 7000,
    wanderStepsMin: 1,
    wanderStepsMax: 6,
    idleChats: [
      '这朵花好漂亮！我以前没见过这种颜色呢。',
      '不知道池塘那边有什么好玩的～',
      '好想去码头看看大海！',
      '听说铁匠铺的师傅手艺很好，我要去看看。',
      '今天要探索小镇的每一个角落！',
      '啊，那边有人！我去打个招呼～',
    ],
    greetings: [
      '嗨！你也是来探险的吗？',
      '你好你好！我是莉莉，很高兴认识你！',
      '哇，你的装扮好特别！你从哪里来的？',
      '嘿！要不要一起去逛逛？',
    ],
  },
];

// NPC 功能是否默认启用
const NPC_ENABLED = process.env.ALICIZATION_TOWN_NPC_ENABLED !== 'false';

module.exports = { NPC_PROFILES, NPC_ENABLED };
