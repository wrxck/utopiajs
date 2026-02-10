// ============================================================================
// @matthesketh/utopia-ai — Shared types
// ============================================================================

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  /** Base64-encoded image data or a URL. */
  source: string;
  mediaType?: string;
}

export interface ToolCallContent {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  id: string;
  content: string;
  isError?: boolean;
}

export type MessageContent =
  | string
  | TextContent
  | ImageContent
  | ToolCallContent
  | ToolResultContent;

export interface ChatMessage {
  role: MessageRole;
  content: MessageContent | MessageContent[];
  name?: string;
}

// ---------------------------------------------------------------------------
// Tools (function calling)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema & { description?: string }>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Chat request / response
// ---------------------------------------------------------------------------

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  /** Adapter-specific options passed through untouched. */
  extra?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: TokenUsage;
  /** Raw response from the provider for advanced use cases. */
  raw?: unknown;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export interface ChatChunk {
  /** Incremental text delta. */
  delta: string;
  /** Incremental tool call delta (partial). */
  toolCallDelta?: Partial<ToolCall> & { index?: number };
  /** Set on the final chunk. */
  finishReason?: ChatResponse['finishReason'];
  /** Set on the final chunk. */
  usage?: TokenUsage;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
  /** Adapter-specific options. */
  extra?: Record<string, unknown>;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  usage?: { totalTokens: number };
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface AIAdapter {
  /** Send a chat completion request. */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Stream a chat completion. Adapters may omit this (falls back to chat). */
  stream?(request: ChatRequest): AsyncIterable<ChatChunk>;
  /** Generate embeddings. Optional capability. */
  embeddings?(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

// ---------------------------------------------------------------------------
// Provider configs
// ---------------------------------------------------------------------------

export interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
  organization?: string;
  defaultModel?: string;
}

export interface AnthropicConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export interface GoogleConfig {
  apiKey: string;
  defaultModel?: string;
}

export interface OllamaConfig {
  baseURL?: string;
  defaultModel?: string;
}

// ---------------------------------------------------------------------------
// Middleware / Hooks
// ---------------------------------------------------------------------------

export interface AIHooks {
  /** Called before every chat request. Can modify the request. */
  onBeforeChat?: (request: ChatRequest) => ChatRequest | Promise<ChatRequest>;
  /** Called after every chat response. Can modify the response. */
  onAfterChat?: (
    response: ChatResponse,
    request: ChatRequest,
  ) => ChatResponse | Promise<ChatResponse>;
  /** Called on any adapter error. */
  onError?: (error: Error, context: { method: string; request?: ChatRequest }) => void;
}

// ---------------------------------------------------------------------------
// Retry config
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Max number of retries (default: 0 = no retry). */
  maxRetries?: number;
  /** Base delay in ms (default: 1000). Doubles on each attempt (exponential backoff). */
  baseDelay?: number;
  /** Whether to retry on this error. Default: retries on network errors and 429/500+ status codes. */
  shouldRetry?: (error: Error) => boolean;
}
