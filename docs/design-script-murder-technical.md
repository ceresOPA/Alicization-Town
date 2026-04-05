# Script Murder Plugin — 技术设计文档

> **插件名**: `town-plugin-murder`
> **依赖插件**: `town-plugin-personality`（前置）
> **适配核心版本**: ≥ 0.7.0（需要 Channel + PlayerStore 接口）

---

## 目录

1. [Prompt 工程架构](#1-prompt-工程架构)
2. [记忆系统设计](#2-记忆系统设计)
3. [剧本数据格式标准](#3-剧本数据格式标准)
4. [游戏引擎 FSM 设计](#4-游戏引擎-fsm-设计)
5. [MCP/CLI 交互设计](#5-mcpcli-交互设计)

---

## 1. Prompt 工程架构

### 1.1 双层角色扮演模型

参考 Wolfcha 的 Dual-Layer Roleplay + Stanford Generative Agents 的认知架构，设计三层 Prompt 堆栈：

```
┌─────────────────────────────────────────────┐
│  Layer 0: System Constitution (系统宪法)      │
│  → 世界观规则 + 伦理约束 + 输出格式            │
├─────────────────────────────────────────────┤
│  Layer 1: Town Personality (小镇人格)         │
│  → 来自 personality 插件的 MBTI + 问卷结果     │
│  → 长期记忆、性格特征、说话风格               │
├─────────────────────────────────────────────┤
│  Layer 2: Game Role Overlay (游戏角色覆层)    │
│  → 剧本杀角色的背景、秘密、目标              │
│  → 当前阶段指令 + 已知线索 + 策略引导         │
└─────────────────────────────────────────────┘
```

### 1.2 各层 Prompt 模板

#### Layer 0 — System Constitution

```
你是 Alicization Town 世界中的一位居民，正在参与一场剧本杀游戏。

【世界规则】
- 你必须保持角色扮演，不能跳出角色
- 你不能直接说出自己的秘密，除非策略性地选择透露
- 你不能捏造不存在的证据或事件
- 你的发言应当简洁有力，每次不超过 150 字
- 使用第一人称

【输出格式】
{
  "speech": "你的台词",
  "inner_thought": "内心想法（不会被其他玩家看到）",
  "action": "可选的动作描述",
  "target": "可选的交互目标角色名"
}
```

#### Layer 1 — Town Personality（来自 personality 插件）

```
【我的小镇身份】
- 名字: {{character.name}}
- MBTI: {{personality.mbti}}
- 性格标签: {{personality.traits | join(', ')}}
- 说话风格: {{personality.speaking_style}}
- 口头禅: {{personality.catchphrase}}
- 价值观: {{personality.values}}

【我与其他人的关系】
{{#each relationships}}
- {{this.name}}: {{this.relation}} (好感度: {{this.affinity}}/100)
{{/each}}

【我最近的记忆摘要】
{{memory.recent_summary}}
```

#### Layer 2 — Game Role Overlay（游戏中动态注入）

```
【当前游戏: 剧本杀 — "{{script.title}}"】

【我的游戏角色】
- 角色名: {{role.name}}
- 年龄/职业: {{role.age}}岁 / {{role.profession}}
- 背景故事: {{role.background}}
- 🔒 我的秘密: {{role.secret}}
- 🎯 我的目标: {{role.objective}}
- 身份: {{#if role.is_murderer}}⚠️ 我是凶手，必须隐藏身份{{else}}我是无辜的，需要找出凶手{{/if}}

【当前阶段: {{phase.name}}】
{{phase.instruction}}

【我已知的线索】
{{#each known_evidence}}
- [{{this.type}}] {{this.name}}: {{this.description}}
{{/each}}

【我的推理笔记】
{{deduction_notes}}

【最近 {{recent_chat.length}} 条对话】
{{#each recent_chat}}
[{{this.character}}]: {{this.message}}
{{/each}}
```

### 1.3 阶段特化指令（Phase Instructions）

| 阶段 | Layer 2 指令 |
|------|-------------|
| BACKGROUND | "仔细阅读案件背景，思考可能的嫌疑人和动机" |
| INTRODUCTION | "以你的角色身份进行自我介绍，不要泄露秘密但可以暗示自己的处境" |
| EVIDENCE_COLLECTION | "前往{location}搜索线索。描述你发现了什么，认真观察每个细节" |
| INVESTIGATION | "基于已知线索，向其他角色提问或分享发现。注意观察谁在说谎" |
| DISCUSSION | "参与圆桌讨论，发表你的推理。如果你是凶手，巧妙地引导怀疑方向" |
| VOTING | "做出最终投票决定并陈述理由。{凶手:暗中引导投给无辜者 / 侦探:基于证据投票}" |
| REVELATION | "真相揭晓，分享你的感受和复盘" |

### 1.4 凶手 vs 侦探 策略引导

**凶手专属 Prompt 补丁**:
```
【策略建议 — 仅你可见】
- 制造合理的不在场证明
- 适度参与讨论但避免过度活跃
- 如果被追问，转移话题到其他可疑线索
- 利用其他人的秘密来制造混乱
- 不要在搜证阶段主动发现指向自己的证据
```

**侦探专属 Prompt 补丁**:
```
【策略建议 — 仅你可见】
- 注意收集物理证据和证言矛盾
- 记录每个人的时间线，找出漏洞
- 关注谁在回避话题或频繁改变说法
- 综合多条线索进行交叉验证
```

---

## 2. 记忆系统设计

### 2.1 架构概览

参考 Stanford Generative Agents 的三维记忆评分（recency × relevance × importance），适配为游戏场景的轻量级版本：

```
┌─────────────────────────────────────────────┐
│              Murder Memory System              │
├─────────────┬──────────────┬─────────────────┤
│  Event Log  │  Clue Memory │  Deduction Log  │
│  (对话日志)  │  (线索记忆)   │  (推理笔记)      │
├─────────────┴──────────────┴─────────────────┤
│            Retrieval Engine (检索引擎)         │
│  score = recency × 0.3 + relevance × 0.5    │
│         + importance × 0.2                   │
├──────────────────────────────────────────────┤
│            Reflection Module (反思模块)        │
│  每阶段结束时 LLM 生成阶段总结 + 推理更新      │
└──────────────────────────────────────────────┘
```

### 2.2 数据结构

```javascript
// MemoryNode — 存入 PlayerStore
{
  id: "mem_001",
  type: "event" | "clue" | "deduction" | "reflection",
  timestamp: 1712345678,
  phase: "INVESTIGATION",          // 哪个阶段产生的
  source: "dialogue" | "search" | "system" | "self",
  
  // 三元组（参考 Stanford SPO）
  subject: "李明",
  predicate: "发现",
  object: "带血的刀",
  
  description: "李明在厨房发现了一把带血的刀",
  importance: 8,                   // 1-10，由 LLM 评分
  keywords: ["刀", "血迹", "厨房", "李明"],
  
  // 线索专用
  evidence_id: "ev_003",          // 关联的剧本证据 ID
  discovered_by: "player_A",
  
  // 推理专用
  hypothesis: "李明可能是凶手",
  confidence: 0.6,                // 0-1
  supporting_evidence: ["mem_002", "mem_005"]
}
```

### 2.3 检索算法（简化版）

```javascript
function retrieve(playerMemories, query, topK = 5) {
  const now = Date.now();
  const queryKeywords = extractKeywords(query);
  
  const scored = playerMemories.map(mem => {
    // 1. 时效性：指数衰减，半衰期 = 10 分钟游戏时间
    const ageMinutes = (now - mem.timestamp) / 60000;
    const recency = Math.exp(-0.069 * ageMinutes);  // ln(2)/10 ≈ 0.069
    
    // 2. 相关性：关键词重合度（轻量替代 embedding cosine）
    const overlap = mem.keywords.filter(k => queryKeywords.includes(k)).length;
    const relevance = overlap / Math.max(queryKeywords.length, 1);
    
    // 3. 重要性：归一化到 0-1
    const importance = mem.importance / 10;
    
    // 加权总分
    const score = recency * 0.3 + relevance * 0.5 + importance * 0.2;
    return { mem, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.mem);
}
```

### 2.4 反思模块

每个阶段结束时，触发一次 LLM 反思生成：

```javascript
async function generateReflection(agent, phaseMemories, currentPhase) {
  const prompt = `
你是 ${agent.role.name}，刚刚经历了 ${currentPhase} 阶段。

本阶段发生的事情：
${phaseMemories.map(m => `- ${m.description}`).join('\n')}

请回答：
1. 本阶段最重要的 3 个发现是什么？
2. 谁的行为最可疑？为什么？
3. 你目前认为凶手是谁？信心程度 (0-100%)？
4. 下一阶段你的策略是什么？

输出 JSON 格式：
{
  "key_findings": ["...", "...", "..."],
  "most_suspicious": { "name": "xxx", "reason": "..." },
  "prime_suspect": { "name": "xxx", "confidence": 0.6 },
  "next_strategy": "..."
}`;
  
  const reflection = await llm.complete(prompt);
  // 存入 PlayerStore 作为 deduction 类型记忆
  return reflection;
}
```

---

## 3. 剧本数据格式标准

### 3.1 设计原则

参考 jubensha-ai 的数据模型，适配为 JSON 格式（Alicization Town 生态 = Node.js + JSON）。

### 3.2 剧本 JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MurderScript",
  "description": "Alicization Town 剧本杀剧本格式 v1.0",
  "type": "object",
  "required": ["meta", "background", "characters", "evidence", "locations", "phases"],
  "properties": {
    "meta": {
      "type": "object",
      "required": ["id", "title", "version", "player_count"],
      "properties": {
        "id": { "type": "string", "description": "唯一标识" },
        "title": { "type": "string", "description": "剧本名称" },
        "version": { "type": "string", "default": "1.0.0" },
        "author": { "type": "string" },
        "description": { "type": "string" },
        "player_count": {
          "type": "object",
          "properties": {
            "min": { "type": "integer", "minimum": 3 },
            "max": { "type": "integer", "maximum": 12 },
            "recommended": { "type": "integer" }
          }
        },
        "difficulty": { "enum": ["easy", "medium", "hard", "expert"] },
        "estimated_minutes": { "type": "integer" },
        "tags": { "type": "array", "items": { "type": "string" } }
      }
    },

    "background": {
      "type": "object",
      "required": ["setting", "incident"],
      "properties": {
        "setting": { "type": "string", "description": "故事背景设定" },
        "incident": { "type": "string", "description": "案件描述" },
        "victim": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "description": { "type": "string" },
            "cause_of_death": { "type": "string" },
            "time_of_death": { "type": "string" },
            "location_of_death": { "type": "string" }
          }
        },
        "timeline": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "time": { "type": "string" },
              "event": { "type": "string" },
              "visibility": { "enum": ["public", "hidden"] }
            }
          }
        }
      }
    },

    "characters": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "role_type", "background", "objective"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "age": { "type": "integer" },
          "gender": { "type": "string" },
          "profession": { "type": "string" },
          "role_type": { "enum": ["murderer", "innocent", "victim", "accomplice"] },
          "background": { "type": "string", "description": "公开背景" },
          "secret": { "type": "string", "description": "仅自己可见的秘密" },
          "objective": { "type": "string", "description": "游戏目标" },
          "personality_traits": {
            "type": "array",
            "items": { "type": "string" }
          },
          "relationships": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "target_id": { "type": "string" },
                "relation": { "type": "string" },
                "detail": { "type": "string" }
              }
            }
          },
          "alibi": {
            "type": "object",
            "properties": {
              "claimed": { "type": "string", "description": "自称的不在场证明" },
              "truth": { "type": "string", "description": "事实" }
            }
          }
        }
      }
    },

    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "description", "location_id"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "type": { "enum": ["physical", "document", "testimony", "digital"] },
          "location_id": { "type": "string", "description": "线索所在场景 ID" },
          "importance": { "enum": ["critical", "major", "minor"] },
          "discovery_condition": { "type": "string", "description": "触发发现的条件描述" },
          "related_character_ids": {
            "type": "array",
            "items": { "type": "string" }
          },
          "is_hidden": { "type": "boolean", "default": false },
          "red_herring": { "type": "boolean", "default": false, "description": "是否为误导线索" }
        }
      }
    },

    "locations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "is_crime_scene": { "type": "boolean", "default": false },
          "zone_id": { "type": "string", "description": "映射到 Alicization Town 的 zone" },
          "searchable_items": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    },

    "phases": {
      "type": "array",
      "description": "游戏阶段定义，按顺序执行",
      "items": {
        "type": "object",
        "required": ["id", "type", "name"],
        "properties": {
          "id": { "type": "string" },
          "type": {
            "enum": [
              "background",
              "introduction",
              "evidence_collection",
              "investigation",
              "discussion",
              "voting",
              "revelation"
            ]
          },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "max_turns": { "type": "integer" },
          "time_limit_seconds": { "type": "integer" },
          "end_conditions": {
            "type": "array",
            "description": "满足任一条件则提前结束",
            "items": {
              "type": "object",
              "properties": {
                "type": {
                  "enum": [
                    "all_spoken",
                    "evidence_threshold",
                    "max_turns_reached",
                    "all_voted",
                    "time_expired"
                  ]
                },
                "params": { "type": "object" }
              }
            }
          }
        }
      }
    },

    "victory_conditions": {
      "type": "object",
      "properties": {
        "innocent_win": { "type": "string", "default": "投票正确指认凶手" },
        "murderer_win": { "type": "string", "default": "未被投票指认或得票未过半" }
      }
    }
  }
}
```

### 3.3 示例剧本（MVP 测试用）

```json
{
  "meta": {
    "id": "script-midnight-manor-001",
    "title": "午夜庄园谋杀案",
    "version": "1.0.0",
    "author": "town-plugin-murder",
    "description": "一场发生在古老庄园中的谋杀案，四位嫌疑人各怀心事...",
    "player_count": { "min": 3, "max": 5, "recommended": 4 },
    "difficulty": "medium",
    "estimated_minutes": 30,
    "tags": ["经典", "推理", "4人本"]
  },

  "background": {
    "setting": "维多利亚风格的午夜庄园，一场暴风雨的夜晚。庄园主人老威廉即将宣布遗嘱内容。",
    "incident": "次日清晨，管家发现老威廉死于书房，桌上的威士忌杯中检出致命剂量的氰化物。",
    "victim": {
      "name": "威廉·克劳福德",
      "description": "72岁的庄园主人，白手起家的企业家，性格专横但对家人慷慨",
      "cause_of_death": "氰化物中毒",
      "time_of_death": "凌晨 1:00 - 2:00",
      "location_of_death": "书房"
    },
    "timeline": [
      { "time": "20:00", "event": "晚宴开始，所有人到齐", "visibility": "public" },
      { "time": "21:30", "event": "老威廉宣布将改写遗嘱", "visibility": "public" },
      { "time": "22:00", "event": "艾琳与老威廉在书房激烈争吵", "visibility": "hidden" },
      { "time": "23:00", "event": "众人各自回房", "visibility": "public" },
      { "time": "00:30", "event": "詹姆斯潜入书房试图查看遗嘱", "visibility": "hidden" },
      { "time": "01:00", "event": "凶手在威士忌中下毒", "visibility": "hidden" },
      { "time": "07:00", "event": "管家发现尸体", "visibility": "public" }
    ]
  },

  "characters": [
    {
      "id": "char-james",
      "name": "詹姆斯",
      "age": 45,
      "gender": "男",
      "profession": "商人（老威廉的儿子）",
      "role_type": "murderer",
      "background": "老威廉的独子，经营家族企业但近年经营不善，负债累累。当晚参加晚宴，得知父亲要改遗嘱后情绪激动。",
      "secret": "我在凌晨 1 点潜入书房，在父亲的威士忌中投入了氰化物。我是凶手。我事先从化工供应商处购买了氰化物。",
      "objective": "掩盖自己的罪行，将嫌疑引向其他人。",
      "personality_traits": ["圆滑", "焦虑", "善于伪装"],
      "relationships": [
        { "target_id": "char-eileen", "relation": "前妻", "detail": "三年前离婚，关系紧张" },
        { "target_id": "char-robert", "relation": "父亲的律师", "detail": "怀疑 Robert 在遗嘱上做手脚" },
        { "target_id": "char-mary", "relation": "管家", "detail": "对 Mary 不太信任" }
      ],
      "alibi": {
        "claimed": "23 点后一直在房间睡觉，直到早上被管家叫醒",
        "truth": "00:30 偷偷去书房查看遗嘱，01:00 投毒后回房"
      }
    },
    {
      "id": "char-eileen",
      "name": "艾琳",
      "age": 42,
      "gender": "女",
      "profession": "艺术策展人（老威廉的前儿媳）",
      "role_type": "innocent",
      "background": "三年前与詹姆斯离婚后，仍与老威廉保持良好关系。老威廉曾承诺在遗嘱中给她留一笔钱。",
      "secret": "22 点我和老威廉在书房争吵，是因为他告诉我新遗嘱里删掉了给我的那份。我很生气但没有动手。我离开后去花园冷静了。",
      "objective": "找出真凶，证明自己的清白。",
      "personality_traits": ["敏感", "聪明", "情绪化"],
      "relationships": [
        { "target_id": "char-james", "relation": "前夫", "detail": "离婚后有遗产纠纷" },
        { "target_id": "char-robert", "relation": "朋友", "detail": "Robert 帮她处理过离婚法律事务" },
        { "target_id": "char-mary", "relation": "相识", "detail": "与 Mary 关系一般" }
      ],
      "alibi": {
        "claimed": "22 点后在花园散步到 23 点，之后回房休息",
        "truth": "实际情况与声称一致，但不想承认与老威廉争吵的内容"
      }
    },
    {
      "id": "char-robert",
      "name": "罗伯特",
      "age": 55,
      "gender": "男",
      "profession": "律师（老威廉的法律顾问）",
      "role_type": "innocent",
      "background": "担任老威廉的私人律师超过 20 年。负责起草新遗嘱，知道遗嘱内容。",
      "secret": "我从旧遗嘱中挪用了老威廉 5 万英镑，已经补回了大部分，但还差 1 万。如果老威廉发现这件事，我的职业生涯就完了。",
      "objective": "找出真凶，同时避免自己挪用公款的事被发现。",
      "personality_traits": ["严谨", "谨慎", "有城府"],
      "relationships": [
        { "target_id": "char-james", "relation": "客户之子", "detail": "知道 James 的财务困境" },
        { "target_id": "char-eileen", "relation": "朋友", "detail": "同情 Eileen 的处境" },
        { "target_id": "char-mary", "relation": "同事关系", "detail": "偶尔交流" }
      ],
      "alibi": {
        "claimed": "23 点后在客房整理法律文件到深夜，没有出过房门",
        "truth": "基本属实，但 00:00 左右听到走廊有脚步声"
      }
    },
    {
      "id": "char-mary",
      "name": "玛丽",
      "age": 60,
      "gender": "女",
      "profession": "庄园管家（服务 30 年）",
      "role_type": "innocent",
      "background": "在庄园服务超过 30 年的忠实管家。第二天早上发现了老威廉的尸体。",
      "secret": "老威廉在新遗嘱中留给我一大笔遗产作为 30 年服务的感谢。我提前从 Robert 那里得知了这个消息。我有动机但没有作案。",
      "objective": "找出真凶。不想让别人知道自己是遗嘱受益人，否则会被怀疑。",
      "personality_traits": ["忠诚", "细心", "朴实"],
      "relationships": [
        { "target_id": "char-james", "relation": "主人之子", "detail": "看着 James 长大，失望于他的挥霍" },
        { "target_id": "char-eileen", "relation": "熟人", "detail": "中立态度" },
        { "target_id": "char-robert", "relation": "知情者", "detail": "Robert 告诉了她遗嘱内容" }
      ],
      "alibi": {
        "claimed": "22:30 完成晚间工作后回自己的房间休息",
        "truth": "基本属实，但凌晨 2 点左右去厨房喝水时经过书房，隐约闻到苦杏仁味"
      }
    }
  ],

  "evidence": [
    {
      "id": "ev-whiskey",
      "name": "威士忌杯残液",
      "description": "书桌上的威士忌杯中检出高浓度氰化物。杯子上只有老威廉的指纹。",
      "type": "physical",
      "location_id": "loc-study",
      "importance": "critical",
      "discovery_condition": "搜索书房时自动发现",
      "related_character_ids": [],
      "is_hidden": false,
      "red_herring": false
    },
    {
      "id": "ev-gloves",
      "name": "乳胶手套碎片",
      "description": "书房壁炉灰烬中发现未完全烧毁的乳胶手套碎片。",
      "type": "physical",
      "location_id": "loc-study",
      "importance": "critical",
      "discovery_condition": "仔细搜索壁炉",
      "related_character_ids": ["char-james"],
      "is_hidden": true,
      "red_herring": false
    },
    {
      "id": "ev-receipt",
      "name": "化学品采购收据",
      "description": "詹姆斯房间垃圾桶中发现一张化工用品采购收据，日期为一周前。",
      "type": "document",
      "location_id": "loc-james-room",
      "importance": "critical",
      "discovery_condition": "搜索詹姆斯的房间",
      "related_character_ids": ["char-james"],
      "is_hidden": true,
      "red_herring": false
    },
    {
      "id": "ev-will-draft",
      "name": "遗嘱草稿",
      "description": "书房保险柜中的遗嘱草稿，显示詹姆斯的继承份额被大幅削减。",
      "type": "document",
      "location_id": "loc-study",
      "importance": "major",
      "discovery_condition": "搜索书房保险柜",
      "related_character_ids": ["char-james", "char-mary", "char-robert"],
      "is_hidden": true,
      "red_herring": false
    },
    {
      "id": "ev-mud-footprints",
      "name": "泥脚印",
      "description": "花园通往书房的走廊有泥脚印，鞋码为女性 38 码。",
      "type": "physical",
      "location_id": "loc-corridor",
      "importance": "minor",
      "discovery_condition": "搜索走廊",
      "related_character_ids": ["char-eileen"],
      "is_hidden": false,
      "red_herring": true
    },
    {
      "id": "ev-financial-records",
      "name": "财务记录异常",
      "description": "老威廉书房中的账本显示法律服务费用出现可疑差额。",
      "type": "document",
      "location_id": "loc-study",
      "importance": "minor",
      "discovery_condition": "仔细翻看书房账本",
      "related_character_ids": ["char-robert"],
      "is_hidden": true,
      "red_herring": true
    }
  ],

  "locations": [
    {
      "id": "loc-study",
      "name": "书房",
      "description": "老威廉的私人书房，案发现场。墙上挂满油画，角落有一个大壁炉。",
      "is_crime_scene": true,
      "zone_id": "manor_study",
      "searchable_items": ["书桌", "威士忌杯", "壁炉", "保险柜", "账本", "书架"]
    },
    {
      "id": "loc-james-room",
      "name": "詹姆斯的房间",
      "description": "庄园二楼的客房，行李整齐但垃圾桶里有些东西。",
      "is_crime_scene": false,
      "zone_id": "manor_room_1",
      "searchable_items": ["衣柜", "垃圾桶", "行李箱", "床头柜"]
    },
    {
      "id": "loc-corridor",
      "name": "走廊",
      "description": "连接花园和各个房间的走廊，地板是大理石。",
      "is_crime_scene": false,
      "zone_id": "manor_corridor",
      "searchable_items": ["地板", "窗台", "花瓶"]
    },
    {
      "id": "loc-garden",
      "name": "花园",
      "description": "庄园后方的英式花园，暴风雨后地面泥泞。",
      "is_crime_scene": false,
      "zone_id": "manor_garden",
      "searchable_items": ["长椅", "花丛", "工具棚"]
    }
  ],

  "phases": [
    {
      "id": "phase-bg",
      "type": "background",
      "name": "案件背景",
      "description": "系统播报案件背景和现场情况",
      "max_turns": 1,
      "end_conditions": [{ "type": "max_turns_reached", "params": {} }]
    },
    {
      "id": "phase-intro",
      "type": "introduction",
      "name": "角色介绍",
      "description": "每位嫌疑人进行自我介绍",
      "max_turns": 8,
      "end_conditions": [
        { "type": "all_spoken", "params": {} },
        { "type": "max_turns_reached", "params": {} }
      ]
    },
    {
      "id": "phase-search",
      "type": "evidence_collection",
      "name": "搜证阶段",
      "description": "各嫌疑人前往不同地点搜索线索",
      "max_turns": 12,
      "end_conditions": [
        { "type": "evidence_threshold", "params": { "percentage": 0.75 } },
        { "type": "max_turns_reached", "params": {} }
      ]
    },
    {
      "id": "phase-discuss",
      "type": "discussion",
      "name": "圆桌讨论",
      "description": "所有嫌疑人集中讨论案情，交流线索，互相质疑",
      "max_turns": 20,
      "end_conditions": [
        { "type": "all_spoken", "params": { "min_rounds": 3 } },
        { "type": "max_turns_reached", "params": {} }
      ]
    },
    {
      "id": "phase-vote",
      "type": "voting",
      "name": "最终投票",
      "description": "每人发表最终陈述后投票指认凶手",
      "max_turns": 8,
      "end_conditions": [
        { "type": "all_voted", "params": {} },
        { "type": "max_turns_reached", "params": {} }
      ]
    },
    {
      "id": "phase-reveal",
      "type": "revelation",
      "name": "真相揭晓",
      "description": "揭晓凶手身份和完整真相",
      "max_turns": 1,
      "end_conditions": [{ "type": "max_turns_reached", "params": {} }]
    }
  ],

  "victory_conditions": {
    "innocent_win": "投票中凶手（詹姆斯）得票最多",
    "murderer_win": "詹姆斯未被投票指认或得票未过半"
  }
}
```

---

## 4. 游戏引擎 FSM 设计

### 4.1 状态机定义

```
                  ┌──────────┐
                  │  IDLE    │  (等待创建游戏)
                  └────┬─────┘
                       │ createGame(scriptId)
                  ┌────▼─────┐
                  │ LOADING  │  (加载剧本 + 分配角色)
                  └────┬─────┘
                       │ loaded
          ┌────────────▼────────────┐
          │  BACKGROUND             │  系统播报
          └────────────┬────────────┘
                       │ next
          ┌────────────▼────────────┐
          │  INTRODUCTION           │  角色自我介绍
          └────────────┬────────────┘
                       │ allSpoken
          ┌────────────▼────────────┐
          │  EVIDENCE_COLLECTION    │  搜证
          └────────────┬────────────┘
                       │ threshold(75%) 或 maxTurns
          ┌────────────▼────────────┐
          │  DISCUSSION             │  圆桌讨论
          └────────────┬────────────┘
                       │ 3*allSpoken 或 maxTurns
          ┌────────────▼────────────┐
          │  VOTING                 │  最终投票
          └────────────┬────────────┘
                       │ allVoted
          ┌────────────▼────────────┐
          │  REVELATION             │  真相揭晓
          └────────────┬────────────┘
                       │ 
          ┌────────────▼────────────┐
          │  ENDED                  │  游戏结束
          └─────────────────────────┘
```

### 4.2 插件内 MurderGameEngine 结构

```javascript
class MurderGameEngine {
  constructor(script, pluginContext) {
    this.script = script;                    // 解析后的剧本数据
    this.ctx = pluginContext;                 // PluginContext
    this.phase = 'IDLE';                     // 当前阶段
    this.players = new Map();                // characterId → { role, agent }
    this.channel = null;                     // 游戏频道
    this.turnCount = 0;
    this.votes = new Map();
    this.discoveredEvidence = new Set();
  }

  async start() {
    // 1. 创建游戏频道
    this.channel = this.ctx.registerChannel('game-main', {
      members: [...this.players.keys()]
    });

    // 2. 为每个玩家初始化 PlayerStore
    for (const [charId, player] of this.players) {
      const store = this.ctx.getPlayerStore(charId);
      store.set('role', player.role);
      store.set('known_evidence', []);
      store.set('memories', []);
      store.set('deduction', null);
    }

    // 3. 进入第一个阶段
    await this.transitionTo('BACKGROUND');
  }

  async transitionTo(phase) {
    this.phase = phase;
    this.turnCount = 0;
    
    // 通过 Channel 广播阶段变更
    this.channel.broadcast({
      type: 'phase_change',
      phase: this.phase,
      description: this.getPhaseDescription()
    });

    // 触发插件事件
    this.ctx.emitActivity({
      type: 'murder:phase_change',
      phase: this.phase,
      gameId: this.id
    });
  }

  // ... runPhase(), selectNextSpeaker(), processVoting(), etc.
}
```

---

## 5. MCP/CLI 交互设计

### 5.1 新增 MCP 工具

```javascript
// packages/mcp-bridge/src/tools/murder.js

export const murderTools = [
  {
    name: "murder_join",
    description: "加入一场剧本杀游戏",
    parameters: { gameId: "string" }
  },
  {
    name: "murder_search",
    description: "在指定地点搜索线索",
    parameters: { locationId: "string", item: "string (可选)" }
  },
  {
    name: "murder_speak",
    description: "在游戏中发言（讨论/质证/辩护）",
    parameters: { message: "string", target: "string (可选)" }
  },
  {
    name: "murder_vote",
    description: "投票指认凶手",
    parameters: { suspectName: "string", reason: "string" }
  },
  {
    name: "murder_status",
    description: "查看当前游戏状态（阶段、已知线索、投票情况）",
    parameters: {}
  },
  {
    name: "murder_notes",
    description: "查看/更新推理笔记",
    parameters: { action: "view|update", content: "string (update时)" }
  }
];
```

### 5.2 新增 CLI 命令

```
town murder create <scriptId>    # 创建游戏
town murder join <gameId>        # 加入游戏
town murder status               # 查看状态
town murder search <location>    # 搜证
town murder speak <message>      # 发言
town murder vote <suspect>       # 投票
town murder notes                # 查看推理笔记
```

---

*文档版本: v1.0-draft*
*最后更新: 研究阶段输出*
