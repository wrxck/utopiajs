// ============================================================================
// @matthesketh/utopia-ai — AI abstraction (like createMailer for email)
// ============================================================================

import type {
  AIAdapter,
  AIHooks,
  RetryConfig,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
  ToolDefinition,
  ToolCall,
} from './types.js';

// ---------------------------------------------------------------------------
// AI instance interface
// ---------------------------------------------------------------------------

export interface AI {
  /** Send a chat completion request. */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Stream a chat completion. */
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
  /** Generate embeddings. */
  embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  /**
   * Run a tool-calling loop: send messages, execute tool calls via the
   * provided handlers, append results, and repeat until the model stops
   * calling tools.
   */
  run(options: RunOptions): Promise<ChatResponse>;
}

export interface ToolHandler {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface RunOptions {
  messages: ChatMessage[];
  tools: ToolHandler[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxRounds?: number;
  onToolCall?: (call: ToolCall, result: unknown) => void;
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// createAI factory
// ---------------------------------------------------------------------------

export interface CreateAIOptions {
  hooks?: AIHooks;
  retry?: RetryConfig;
}

/**
 * Create an AI instance with the given adapter.
 *
 * Usage:
 * ```ts
 * import { createAI } from '@matthesketh/utopia-ai';
 * import { openaiAdapter } from '@matthesketh/utopia-ai/openai';
 *
 * const ai = createAI(openaiAdapter({ apiKey: process.env.OPENAI_API_KEY }));
 *
 * const res = await ai.chat({
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 *
 * // Streaming
 * for await (const chunk of ai.stream({ messages })) {
 *   process.stdout.write(chunk.delta);
 * }
 *
 * // Agentic tool loop
 * const result = await ai.run({
 *   messages: [{ role: 'user', content: 'What is the weather?' }],
 *   tools: [{
 *     definition: { name: 'get_weather', description: '...', parameters: { type: 'object', properties: {} } },
 *     handler: async ({ city }) => ({ temp: 72 }),
 *   }],
 * });
 * ```
 */
export function createAI(adapter: AIAdapter, options?: CreateAIOptions): AI {
  const hooks = options?.hooks;
  const retry = options?.retry;

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      let req = request;
      if (hooks?.onBeforeChat) {
        req = await hooks.onBeforeChat(req);
      }
      try {
        const response = await withRetry(() => adapter.chat(req), retry);
        if (hooks?.onAfterChat) {
          return await hooks.onAfterChat(response, req);
        }
        return response;
      } catch (err: any) {
        hooks?.onError?.(err, { method: 'chat', request: req });
        throw err;
      }
    },

    stream(request: ChatRequest): AsyncIterable<ChatChunk> {
      const source = adapter.stream
        ? adapter.stream
        : (r: ChatRequest) => chatToStream(adapter, r);

      // Wrap with hooks (no retry for streaming)
      const wrapped = async function* (): AsyncIterable<ChatChunk> {
        let req = request;
        if (hooks?.onBeforeChat) {
          req = await hooks.onBeforeChat(req);
        }
        try {
          yield* source.call(adapter, req);
        } catch (err: any) {
          hooks?.onError?.(err, { method: 'stream', request: req });
          throw err;
        }
      };

      return wrapped();
    },

    embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      if (!adapter.embeddings) {
        throw new Error('@matthesketh/utopia-ai: This adapter does not support embeddings.');
      }
      return adapter.embeddings(request);
    },

    async run(options: RunOptions): Promise<ChatResponse> {
      const {
        tools,
        maxRounds = 10,
        onToolCall,
        ...requestBase
      } = options;

      const messages = [...options.messages];
      const toolDefs = tools.map((t) => t.definition);
      const handlerMap = new Map(tools.map((t) => [t.definition.name, t.handler]));

      for (let round = 0; round < maxRounds; round++) {
        const chatReq: ChatRequest = {
          ...requestBase,
          messages,
          tools: toolDefs,
          toolChoice: 'auto',
        };

        let req = chatReq;
        if (hooks?.onBeforeChat) {
          req = await hooks.onBeforeChat(req);
        }

        let response: ChatResponse;
        try {
          response = await withRetry(() => adapter.chat(req), retry);
        } catch (err: any) {
          hooks?.onError?.(err, { method: 'run', request: req });
          throw err;
        }

        if (hooks?.onAfterChat) {
          response = await hooks.onAfterChat(response, req);
        }

        // If no tool calls, we're done
        if (!response.toolCalls || response.toolCalls.length === 0) {
          return response;
        }

        // Append assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.toolCalls.map((tc) => ({
            type: 'tool_call' as const,
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        });

        // Execute each tool call
        for (const call of response.toolCalls) {
          const handler = handlerMap.get(call.name);
          let result: unknown;
          let isError = false;

          if (!handler) {
            result = `Tool "${call.name}" not found`;
            isError = true;
          } else {
            try {
              result = await handler(call.arguments);
            } catch (err: any) {
              result = err.message ?? String(err);
              isError = true;
            }
          }

          onToolCall?.(call, result);

          messages.push({
            role: 'tool',
            content: [{
              type: 'tool_result',
              id: call.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
              isError,
            }],
          });
        }
      }

      // Max rounds reached — return last chat response
      const finalReq: ChatRequest = {
        ...requestBase,
        messages,
        tools: toolDefs,
        toolChoice: 'none',
      };

      let req = finalReq;
      if (hooks?.onBeforeChat) {
        req = await hooks.onBeforeChat(req);
      }

      let finalResponse: ChatResponse;
      try {
        finalResponse = await withRetry(() => adapter.chat(req), retry);
      } catch (err: any) {
        hooks?.onError?.(err, { method: 'run', request: req });
        throw err;
      }

      if (hooks?.onAfterChat) {
        finalResponse = await hooks.onAfterChat(finalResponse, req);
      }

      return finalResponse;
    },
  };
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

async function withRetry<T>(fn: () => Promise<T>, config?: RetryConfig): Promise<T> {
  const maxRetries = config?.maxRetries ?? 0;
  const baseDelay = config?.baseDelay ?? 1000;
  const shouldRetry = config?.shouldRetry ?? defaultShouldRetry;

  let lastError: Error;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries && shouldRetry(err)) {
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError!;
}

function defaultShouldRetry(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return msg.includes('network') || msg.includes('timeout') ||
         msg.includes('429') || msg.includes('500') ||
         msg.includes('502') || msg.includes('503') || msg.includes('econnreset');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* chatToStream(
  adapter: AIAdapter,
  request: ChatRequest,
): AsyncIterable<ChatChunk> {
  const response = await adapter.chat(request);
  yield {
    delta: response.content,
    finishReason: response.finishReason,
    usage: response.usage,
  };
}
