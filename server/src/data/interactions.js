// 区域互动内容数据
// 内容数据独立于引擎逻辑，方便扩写世界观时不触碰状态机。

const ZONE_INTERACTIONS = {
  building: {
    restaurant: [
      { action: '点了一碗兰州牛肉拉面', result: '热腾腾的面条端上来了，牛肉鲜嫩，汤头浓郁。你感到精力充沛！', icon: 'Noodle', sound: 'interact' },
      { action: '点了一碗重庆小面', result: '辣得过瘾！麻辣鲜香在口中爆炸，额头冒出细汗。', icon: 'Noodle', sound: 'interact' },
      { action: '吃了份寿司拼盘', result: '新鲜的鱼生入口即化，米饭粒粒分明。', icon: 'Sushi', sound: 'interact' },
      { action: '点了一份烤串', result: '滋滋冒油的烤肉串，撒上孜然和辣椒面，香气扑鼻。', icon: 'Meat', sound: 'interact' },
      { action: '和老板聊了几句', result: '老板说最近有冒险者从东边的森林回来，带回了奇怪的消息。', icon: 'FortuneCookie', sound: 'chat' },
    ],
    inn: [
      { action: '在壁炉旁休息', result: '温暖的火焰让你放松下来，恢复了体力。', icon: 'Heart', sound: 'heal' },
      { action: '向旅馆老板打听消息', result: '老板说："最近小镇来了不少新面孔，练习场那边很热闹。"', icon: 'FortuneCookie', sound: 'chat' },
      { action: '翻看留言簿', result: '留言簿上写着："池塘深处似乎藏着什么秘密..."', icon: 'GoldKey', sound: 'interact' },
      { action: '喝了杯蜂蜜牛奶', result: '香甜的蜂蜜牛奶暖入心脾，旅途的疲惫一扫而空。', icon: 'MilkPot', sound: 'heal' },
    ],
    weapon: [
      { action: '浏览武器架', result: '精钢长剑、橡木法杖、短弓和投掷飞刀。店主推荐了一把附魔匕首。', icon: 'Sword', sound: 'interact' },
      { action: '试挥一把武士刀', result: '刀锋划破空气发出嗡鸣，手感极佳。店主微笑着说："好眼光。"', icon: 'Katana', sound: 'interact' },
      { action: '和店主聊天', result: '退役老兵店主说："好武器要配好技术，去练习场磨练一下吧。"', icon: 'Sword', sound: 'chat' },
    ],
    potion: [
      { action: '查看药水货架', result: '红色恢复药水、蓝色魔力药水、绿色解毒药水，还有闪着紫光的神秘药剂。', icon: 'LifePot', sound: 'magic' },
      { action: '请女巫占卜', result: '女巫凝视水晶球："你的命运与这个小镇紧密相连，重要的相遇即将到来..."', icon: 'WaterPot', sound: 'magic' },
      { action: '试喝一瓶恢复药水', result: '温热的液体流过喉咙，你感到伤口在愈合，精神焕发。', icon: 'LifePot', sound: 'heal' },
    ],
    practice: [
      { action: '进行剑术训练', result: '你挥舞木剑练习基本招式。老剑士纠正了你的姿势，技巧有所提升！', icon: 'Sword', sound: 'interact' },
      { action: '观摩他人比试', result: '两个冒险者正在切磋，剑光闪烁。你从旁观中学到了实战技巧。', icon: 'Katana', sound: 'interact' },
      { action: '进行体能训练', result: '跑步、俯卧撑、深蹲...你大汗淋漓，但感觉更强壮了。', icon: 'Heart', sound: 'interact' },
      { action: '练习射箭', result: '你拉满弓弦，箭矢呼啸着射向靶心——差了一点！再来一次。', icon: 'Bow', sound: 'interact' },
    ],
    warehouse: [
      { action: '查看库存', result: '仓库里堆满了粮食、药草、矿石、木材。管理员正在清点货物。', icon: 'GoldCoin', sound: 'interact' },
      { action: '发现一个旧箱子', result: '角落里的旧箱子里有几枚古老的金币和一张泛黄的地图。', icon: 'GoldKey', sound: 'interact' },
    ],
    shrine: [
      { action: '在许愿池投硬币', result: '金币在空中旋转，落入清澈的池水中。你许了一个愿望。', icon: 'GoldCoin', sound: 'magic' },
      { action: '参拜神社', result: '你双手合十虔诚地参拜。一阵温暖的微风吹过，似乎有神秘力量在回应。', icon: 'Heart', sound: 'magic' },
      { action: '点燃石灯笼', result: '柔和的光芒照亮了神社院落。空气中弥漫着淡淡的檀香。', icon: 'LifePot', sound: 'magic' },
      { action: '解读石碑上的铭文', result: '古老的文字："当七星连珠之时，沉睡之门将再次开启。"', icon: 'GoldKey', sound: 'interact' },
    ],
    farm: [
      { action: '帮助农夫收割麦子', result: '金黄的麦田里劳作，虽然辛苦，但丰收的喜悦让人心满意足。', icon: 'Honey', sound: 'interact' },
      { action: '在菜园里采摘蔬菜', result: '新鲜的番茄、黄瓜和萝卜，都是今天早上刚成熟的。', icon: 'Onigiri', sound: 'interact' },
      { action: '喂农场动物', result: '鸡鸣、牛叫、羊咩咩，动物们吃到食物后显得很开心。', icon: 'Heart', sound: 'heal' },
      { action: '品尝刚出炉的面包', result: '农夫妻子用自家小麦烤的面包，外酥内软，带着淡淡的甜味。', icon: 'Meat', sound: 'interact' },
    ],
    blacksmith: [
      { action: '观摩锻造过程', result: '铁匠把通红的铁块放在铁砧上，火花四溅。精湛手艺让人叹为观止。', icon: 'Sword', sound: 'interact' },
      { action: '请铁匠修复装备', result: '铁匠敲敲打打后焕然一新。"像新的一样！"他自豪地说。', icon: 'Katana', sound: 'interact' },
      { action: '试穿一套铠甲', result: '钢铁铠甲闪闪发光，穿上后感觉自己像个真正的骑士。', icon: 'Sword', sound: 'interact' },
      { action: '学习基础锻造', result: '铁匠教你控制炉温和锤击力度。你成功打出了一枚粗糙的铁钉！', icon: 'Katana', sound: 'interact' },
    ],
    dock: [
      { action: '坐在码头钓鱼', result: '微风吹过水面，远处传来海鸥叫声。终于，一条肥鱼上钩了！', icon: 'Fish', sound: 'interact' },
      { action: '检查停泊的小船', result: '船舱里藏着一张航海图，上面标记着"龙之岛"的位置。', icon: 'GoldKey', sound: 'interact' },
      { action: '和渔夫聊天', result: '老渔夫说："最近海里出现了发光的鱼，老一辈说那是海神的使者。"', icon: 'FortuneCookie', sound: 'chat' },
      { action: '望向远方的海面', result: '夕阳映照在海面上，金光粼粼。远处隐约可见一座小岛的轮廓。', icon: 'WaterPot', sound: 'heal' },
    ],
    watchtower: [
      { action: '登上塔顶瞭望', result: '从塔顶看到整个小镇：北边仓库、南边图书馆、冒险者工会、东边茂密森林...一切尽收眼底。', icon: 'Bow', sound: 'interact' },
      { action: '和守卫交谈', result: '守卫说："最近东方森林有异常动静，可能有魔物出没。大家要小心。"', icon: 'Sword', sound: 'chat' },
      { action: '使用望远镜', result: '透过古老的望远镜，你看到远方山脉中有一座隐藏的城堡。', icon: 'GoldKey', sound: 'interact' },
    ],
    hotspring: [
      { action: '泡温泉放松', result: '温暖的泉水包裹全身，疲劳感一扫而空。据说还能治愈伤口。', icon: 'Heart', sound: 'heal' },
      { action: '收集温泉水', result: '你用瓶子装了些温泉水。这种含矿物质的水可以用来制药水。', icon: 'WaterPot', sound: 'interact' },
      { action: '享受温泉蒸汽', result: '氤氲的蒸汽让人仿佛置身仙境。远处传来风铃声，无比宁静。', icon: 'MilkPot', sound: 'heal' },
    ],
    marketplace: [
      { action: '逛小摊', result: '摊位上摆满了魔法卷轴、水晶球、远方香料、手工饰品。', icon: 'GoldCoin', sound: 'interact' },
      { action: '和商人讨价还价', result: '你看中了一颗水晶球，经过激烈讨价还价，以合理价格买下。', icon: 'GoldCoin', sound: 'chat' },
      { action: '品尝街头小吃', result: '烤红薯、糖葫芦、热腾腾的包子...集市上的美食让人目不暇接。', icon: 'Onigiri', sound: 'interact' },
      { action: '听街头艺人演奏', result: '流浪乐师弹奏竖琴，悠扬的旋律吸引了不少路人驻足聆听。', icon: 'Heart', sound: 'heal' },
    ],
  },
  nature: {
    tree: [
      { action: '在树荫下乘凉', result: '微风吹过树叶沙沙作响。你注意到树干上刻着一些古老的符文。', icon: 'Honey', sound: 'heal' },
      { action: '爬上树瞭望', result: '从高处看到整个小镇。练习场传来金属碰撞声，池塘在阳光下闪闪发光。', icon: 'Honey', sound: 'interact' },
      { action: '采集树上的果实', result: '你摘到了几个成熟的野果，味道酸甜可口，汁水充沛。', icon: 'Honey', sound: 'interact' },
    ],
    pond: [
      { action: '观赏池塘里的鱼', result: '几条锦鲤在水中悠然游弋，睡莲花瓣微微颤动。水面下似乎有什么闪光。', icon: 'Fish', sound: 'interact' },
      { action: '在池塘边发呆', result: '你静静坐在池塘边，听着水声和鸟鸣。难得的宁静时光。', icon: 'WaterPot', sound: 'heal' },
      { action: '尝试钓鱼', result: '你找了根树枝当鱼竿。等了一会儿，感到一阵拉扯——钓到了一条小鱼！', icon: 'Fish', sound: 'interact' },
      { action: '掬一捧清水洗脸', result: '清凉的泉水让你精神一振。水面倒映着天空和你的面庞。', icon: 'WaterPot', sound: 'heal' },
    ],
    grassland: [
      { action: '在草地上躺下', result: '柔软的草地很舒服，你望着天空中飘过的云朵，心情变得轻松愉快。', icon: 'Heart', sound: 'heal' },
      { action: '采集草药', result: '你在草丛中发现了一些有用的草药，也许药水铺会感兴趣。', icon: 'Honey', sound: 'interact' },
    ],
  },
  floor: {
    paved: [
      { action: '观察石板路', result: '石板路上留有各种脚印和车辙，可以看出这里是小镇的主要通道。', icon: 'GoldCoin', sound: 'interact' },
    ],
  },
  landmark: {
    billboard: [
      { action: '阅读告示牌', result: '告示牌上写着:\n「欢迎来到 Alicization Town — 一个 AI Agent 可以自由探索、社交和生活的虚拟小镇。\n这是一个开源项目，旨在探索多 Agent 在虚拟环境中的互动与协作。\n项目地址: https://github.com/ceresOPA/Alicization-Town」', icon: 'FortuneCookie', sound: 'interact' },
      { action: '仔细端详告示牌', result: '木质告示牌上钉着一张羊皮纸，字迹工整。底部还有一行小字："每一个来到这里的灵魂，都在书写这个世界的故事。"', icon: 'GoldKey', sound: 'interact' },
    ],
  },
};

// Tiled 导出的区域名可能中英混用，因此这里用正则做统一归类。
const ZONE_CATEGORY_MAP = [
  [/noodle|restaurant|面馆/, 'restaurant'], [/inn|旅馆/, 'inn'],
  [/weapon|armor|武器/, 'weapon'], [/potion|magic|药水/, 'potion'],
  [/practice|练习/, 'practice'], [/warehouse|仓库/, 'warehouse'],
  [/shrine|神社/, 'shrine'], [/farm|农场/, 'farm'],
  [/blacksmith|铁匠/, 'blacksmith'], [/dock|码头/, 'dock'],
  [/watchtower|瞭望/, 'watchtower'], [/hot\s?spring|温泉/, 'hotspring'],
  [/market|集市/, 'marketplace'], [/tree|树/, 'tree'],
  [/pond|池塘/, 'pond'], [/grass|草/, 'grassland'],
  [/paved|石板/, 'paved'],
  [/billboard|告示牌/, 'billboard'],
];

module.exports = { ZONE_INTERACTIONS, ZONE_CATEGORY_MAP };
