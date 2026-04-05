// ============================================================================
// 关联记忆系统（受 Stanford Generative Agents 启发）
// ============================================================================
// 记忆节点结构：
//   - description: 文本描述
//   - type: event | thought | chat
//   - embedding: 向量表示
//   - importance: 重要性分数 (1-10)
//   - timestamp: 创建时间
//
// 检索评分（与论文一致的三维）:
//   score = 0.5 * recency + 3.0 * relevance + 2.0 * importance
//
// 说明：
//   - recency: 近期性，指数衰减
//   - relevance: 与查询的语义相似度（余弦）
//   - importance: 记忆本身的重要程度（主观打分）
// ============================================================================

'use strict';

const { embed, cosineSimilarity } = require('./embedding');

class AssociativeMemory {
  constructor() {
    /** @type {Array<MemoryNode>} */
    this.nodes = [];
  }

  /**
   * 添加一条记忆
   *
   * @param {object} memory
   * @param {string} memory.description
   * @param {'event'|'thought'|'chat'} [memory.type]
   * @param {number} [memory.importance] - 1-10
   * @param {number} [memory.timestamp] - unix ms
   * @returns {Promise<MemoryNode>}
   */
  async add(memory) {
    const description = String(memory.description || '').trim();
    if (!description) {
      throw new Error('memory.description 不能为空');
    }

    const node = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: memory.type || 'event',
      description,
      importance: clamp(memory.importance ?? 5, 1, 10),
      timestamp: memory.timestamp || Date.now(),
      embedding: await embed(description),
    };

    this.nodes.push(node);
    return node;
  }

  /**
   * 检索与 query 最相关的记忆
   *
   * @param {string} query
   * @param {object} [options]
   * @param {number} [options.topK=8]
   * @param {number} [options.now]
   * @returns {Promise<Array<MemoryNode & {score:number,relevance:number,recency:number,importanceNorm:number}>>}
   */
  async retrieve(query, options = {}) {
    const topK = options.topK ?? 8;
    const now = options.now || Date.now();

    if (!this.nodes.length) return [];

    const qEmbedding = await embed(query);

    const scored = this.nodes.map(node => {
      const relevance = cosineSimilarity(qEmbedding, node.embedding);
      const recency = calcRecency(node.timestamp, now);
      const importanceNorm = node.importance / 10;

      const score = (0.5 * recency) + (3.0 * relevance) + (2.0 * importanceNorm);

      return {
        ...node,
        score,
        relevance,
        recency,
        importanceNorm,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

/**
 * 近期性计算：指数衰减
 * 半衰期默认 6 小时，可按游戏节奏调整
 */
function calcRecency(timestamp, now, halfLifeMs = 6 * 60 * 60 * 1000) {
  const dt = Math.max(0, now - timestamp);
  const lambda = Math.log(2) / halfLifeMs;
  return Math.exp(-lambda * dt);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

module.exports = { AssociativeMemory };

/**
 * @typedef {object} MemoryNode
 * @property {string} id
 * @property {'event'|'thought'|'chat'} type
 * @property {string} description
 * @property {number} importance
 * @property {number} timestamp
 * @property {Float32Array|number[]} embedding
 */
