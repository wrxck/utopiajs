// ============================================================================
// @matthesketh/utopia-ai — Ollama Adapter (local models, no SDK needed)
// ============================================================================

import type {
  AIAdapter,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
  OllamaConfig,
  ToolCall,
  ToolDefinition,
} from '../types.js';

// ---------------------------------------------------------------------------
// Internal Ollama API types (no SDK — native fetch)
// ---------------------------------------------------------------------------

interface OllamaMessage {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options: Record<string, unknown>;
  tools?: OllamaToolParam[];
}

interface OllamaToolParam {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface OllamaChatResponse {
  message?: OllamaMessage;
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Matches a trailing slash for URL normalization. */
export const TRAILING_SLASH_RE = /\/$/;

/** Monotonic counter for generating unique tool call IDs. */
let ollamaToolCallCounter = 0;

/**
 * Create an Ollama adapter for local models.
 *
 * No external dependencies required — uses native fetch.
 *
 * ```ts
 * import { createAI } from '@matthesketh/utopia-ai';
 * import { ollamaAdapter } from '@matthesketh/utopia-ai/ollama';
 *
 * const ai = createAI(ollamaAdapter({ defaultModel: 'llama3.2' }));
 * ```
 */
export function ollamaAdapter(config: OllamaConfig = {}): AIAdapter {
  const baseURL = (config.baseURL ?? 'http://localhost:11434').replace(TRAILING_SLASH_RE, '');

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const model = request.model ?? config.defaultModel ?? 'llama3.2';

      const options: Record<string, unknown> = {};
      if (request.temperature !== undefined) options.temperature = request.temperature;
      if (request.topP !== undefined) options.top_p = request.topP;
      if (request.maxTokens !== undefined) options.num_predict = request.maxTokens;
      if (request.stop) options.stop = request.stop;

      const body: OllamaChatRequest = {
        model,
        messages: toOllamaMessages(request.messages),
        stream: false,
        options,
      };

      if (request.tools?.length) {
        body.tools = request.tools.map(toOllamaTool);
      }

      const response = await fetch(`${baseURL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama error ${response.status}: ${text}`);
      }

      const data: OllamaChatResponse = await response.json();

      const toolCalls: ToolCall[] = (data.message?.tool_calls ?? []).map((tc: OllamaToolCall) => ({
        id: `call_${++ollamaToolCallCounter}_${Date.now().toString(36)}`,
        name: tc.function.name,
        arguments: tc.function.arguments ?? {},
      }));

      return {
        content: data.message?.content ?? '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: data.done_reason === 'length' ? 'length' : 'stop',
        usage: {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
        raw: data,
      };
    },

    async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
      const model = request.model ?? config.defaultModel ?? 'llama3.2';

      const streamOptions: Record<string, unknown> = {};
      if (request.temperature !== undefined) streamOptions.temperature = request.temperature;
      if (request.topP !== undefined) streamOptions.top_p = request.topP;
      if (request.maxTokens !== undefined) streamOptions.num_predict = request.maxTokens;
      if (request.stop) streamOptions.stop = request.stop;

      const body: OllamaChatRequest = {
        model,
        messages: toOllamaMessages(request.messages),
        stream: true,
        options: streamOptions,
      };

      if (request.tools?.length) {
        body.tools = request.tools.map(toOllamaTool);
      }

      const response = await fetch(`${baseURL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama error ${response.status}: ${text}`);
      }

      if (!response.body) {
        throw new Error('Response body is null — streaming not supported');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let data: OllamaChatResponse;
          try {
            data = JSON.parse(line);
          } catch {
            continue;
          }

          yield {
            delta: data.message?.content ?? '',
            finishReason: data.done ? 'stop' : undefined,
            usage: data.done
              ? {
                  promptTokens: data.prompt_eval_count ?? 0,
                  completionTokens: data.eval_count ?? 0,
                  totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
                }
              : undefined,
          };
        }
      }
    },

    async embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      const model = request.model ?? 'nomic-embed-text';
      const inputs = Array.isArray(request.input) ? request.input : [request.input];

      const results: number[][] = [];

      for (const input of inputs) {
        const response = await fetch(`${baseURL}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Ollama error ${response.status}: ${text}`);
        }

        const data = await response.json();
        results.push(...(data.embeddings ?? [data.embedding]));
      }

      return { embeddings: results };
    },
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toOllamaMessages(messages: ChatMessage[]): OllamaMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    if (Array.isArray(msg.content)) {
      const texts: string[] = [];
      const images: string[] = [];

      for (const part of msg.content) {
        if (typeof part === 'string') {
          texts.push(part);
        } else if (part.type === 'text') {
          texts.push(part.text);
        } else if (part.type === 'image') {
          images.push(part.source);
        } else if (part.type === 'tool_result') {
          texts.push(part.content);
        }
      }

      return {
        role: msg.role === 'tool' ? 'user' : msg.role,
        content: texts.join('\n'),
        ...(images.length > 0 ? { images } : {}),
      };
    }

    const part = msg.content;
    if (part.type === 'text') {
      return { role: msg.role, content: part.text };
    }

    return { role: msg.role, content: '' };
  });
}

function toOllamaTool(tool: ToolDefinition): OllamaToolParam {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  };
}
