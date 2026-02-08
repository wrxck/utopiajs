// ============================================================================
// @utopia/ai — Public API
// ============================================================================

export { createAI } from './ai.js';
export { streamSSE, collectStream, parseSSEStream } from './streaming.js';

export type { AI, ToolHandler, RunOptions, CreateAIOptions } from './ai.js';

export type {
  AIAdapter,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  ChatMessage,
  MessageRole,
  MessageContent,
  TextContent,
  ImageContent,
  ToolCallContent,
  ToolResultContent,
  ToolDefinition,
  ToolCall,
  TokenUsage,
  JsonSchema,
  EmbeddingRequest,
  EmbeddingResponse,
  OpenAIConfig,
  AnthropicConfig,
  GoogleConfig,
  OllamaConfig,
  AIHooks,
  RetryConfig,
} from './types.js';
