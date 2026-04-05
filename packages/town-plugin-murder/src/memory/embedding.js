// ============================================================================
// 嵌入向量引擎 — @huggingface/transformers 封装
// ============================================================================
// 使用 Hugging Face Transformers.js 在本地运行文本嵌入模型
// 默认模型: Xenova/bge-small-zh-v1.5 (512维, ~130MB, 中文优化)
//
// 特点：
//   - 零 API 成本（本地 ONNX 推理）
//   - 首次使用自动下载模型（之后缓存）
//   - 支持 q8 量化（更快更小）
//   - 余弦相似度计算
// ============================================================================

'use strict';

let _pipeline = null;
let _extractor = null;

/**
 * 初始化嵌入模型（惰性加载，首次调用时下载模型）
 *
 * @param {object} [options]
 * @param {string} [options.model]  - 模型名称，默认 Xenova/bge-small-zh-v1.5
 * @param {string} [options.dtype]  - 量化类型: fp32 | fp16 | q8 | q4
 * @returns {Promise<object>} pipeline 实例
 */
async function initEmbedding(options = {}) {
  if (_extractor) return _extractor;

  const model = options.model
    || process.env.MURDER_EMBEDDING_MODEL
    || 'Xenova/bge-small-zh-v1.5';

  const dtype = options.dtype
    || process.env.MURDER_EMBEDDING_DTYPE
    || 'q8';

  console.log(`[murder-memory] 正在加载嵌入模型: ${model} (${dtype})...`);

  // 动态 import Transformers.js (ESM)
  const { pipeline: createPipeline } = await import('@huggingface/transformers');

  _extractor = await createPipeline('feature-extraction', model, { dtype });
  console.log(`[murder-memory] 嵌入模型加载完成: ${model}`);

  return _extractor;
}

/**
 * 生成文本的嵌入向量
 *
 * @param {string} text - 输入文本
 * @returns {Promise<Float32Array>} 嵌入向量
 */
async function embed(text) {
  const extractor = await initEmbedding();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return output.data;
}

/**
 * 批量生成嵌入向量
 *
 * @param {string[]} texts - 输入文本数组
 * @returns {Promise<Float32Array[]>} 嵌入向量数组
 */
async function embedBatch(texts) {
  const extractor = await initEmbedding();
  const results = [];
  for (const text of texts) {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    results.push(output.data);
  }
  return results;
}

/**
 * 计算两个向量的余弦相似度
 * 前提：向量已归一化（normalize: true），所以点积即余弦相似度
 *
 * @param {Float32Array|number[]} a
 * @param {Float32Array|number[]} b
 * @returns {number} 相似度 [-1, 1]
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot; // 已归一化，点积 = 余弦相似度
}

module.exports = { initEmbedding, embed, embedBatch, cosineSimilarity };
