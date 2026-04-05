// ============================================================================
// LLM Provider 工厂 — 可配置的大模型接入层
// ============================================================================
// 通过环境变量或 options 参数选择 LLM 提供商，支持：
//   - OpenAI   (GPT-4o-mini / GPT-4o)
//   - Anthropic (Claude Sonnet / Haiku)
//   - DeepSeek  (V3 / Chat)
//   - 任何 OpenAI 兼容 API（通过 baseURL 配置）
//
// 使用动态 import() 加载对应的 LangChain provider 包，
// 避免安装不需要的依赖。
// ============================================================================

'use strict';

/**
 * 创建 LLM 实例
 *
 * @param {object} [options]
 * @param {string} [options.provider]  - 提供商: openai | anthropic | deepseek | custom
 * @param {string} [options.model]     - 模型名称
 * @param {string} [options.apiKey]    - API 密钥
 * @param {string} [options.baseURL]   - 自定义 API 地址（仅 custom/deepseek）
 * @param {number} [options.temperature] - 温度参数，剧本杀推荐 0.7-0.9
 * @returns {Promise<import('@langchain/core/language_models/chat_models').BaseChatModel>}
 */
async function createLLM(options = {}) {
  const provider = options.provider || process.env.MURDER_LLM_PROVIDER || 'openai';
  const apiKey = options.apiKey || process.env.MURDER_LLM_API_KEY;
  const temperature = options.temperature ?? 0.8;

  if (!apiKey) {
    throw new Error(
      `[town-plugin-murder] 缺少 LLM API 密钥。\n` +
      `请设置环境变量 MURDER_LLM_API_KEY 或在创建游戏时传入 apiKey 参数。`
    );
  }

  switch (provider) {
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({
        model: options.model || process.env.MURDER_LLM_MODEL || 'gpt-4o-mini',
        openAIApiKey: apiKey,
        temperature,
      });
    }

    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      return new ChatAnthropic({
        model: options.model || process.env.MURDER_LLM_MODEL || 'claude-sonnet-4-20250514',
        anthropicApiKey: apiKey,
        temperature,
      });
    }

    case 'deepseek': {
      // DeepSeek 使用 OpenAI 兼容 API
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({
        model: options.model || process.env.MURDER_LLM_MODEL || 'deepseek-chat',
        openAIApiKey: apiKey,
        temperature,
        configuration: {
          baseURL: options.baseURL || process.env.MURDER_LLM_BASE_URL || 'https://api.deepseek.com/v1',
        },
      });
    }

    case 'custom': {
      // 任何 OpenAI 兼容 API（如本地 Ollama、vLLM 等）
      const baseURL = options.baseURL || process.env.MURDER_LLM_BASE_URL;
      if (!baseURL) {
        throw new Error('[town-plugin-murder] custom provider 需要设置 MURDER_LLM_BASE_URL');
      }
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({
        model: options.model || process.env.MURDER_LLM_MODEL || 'default',
        openAIApiKey: apiKey,
        temperature,
        configuration: { baseURL },
      });
    }

    default:
      throw new Error(
        `[town-plugin-murder] 不支持的 LLM provider: "${provider}"。\n` +
        `支持: openai, anthropic, deepseek, custom`
      );
  }
}

module.exports = { createLLM };
