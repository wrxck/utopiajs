// ============================================================================
// @matthesketh/utopia-ai — Public API
// ============================================================================

export { createAI } from './ai';
export { streamSSE, collectStream, parseSSEStream } from './streaming';

export type { AI, ToolHandler, RunOptions, CreateAIOptions } from './ai';

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
} from './types';
