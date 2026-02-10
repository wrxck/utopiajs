// ============================================================================
// @matthesketh/utopia-ai — OpenAI Adapter
// ============================================================================

import type {
  AIAdapter,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
  OpenAIConfig,
  ToolCall,
  ToolDefinition,
} from '../types.js';

import type OpenAI from 'openai';

/**
 * Create an OpenAI adapter.
 *
 * Requires `openai` as a peer dependency.
 *
 * ```ts
 * import { createAI } from '@matthesketh/utopia-ai';
 * import { openaiAdapter } from '@matthesketh/utopia-ai/openai';
 *
 * const ai = createAI(openaiAdapter({ apiKey: process.env.OPENAI_API_KEY }));
 * ```
 */
export function openaiAdapter(config: OpenAIConfig): AIAdapter {
  let client: OpenAI | null = null;

  async function getClient(): Promise<OpenAI> {
    if (client) return client;

    let OpenAICtor: new (opts: {
      apiKey: string;
      baseURL?: string;
      organization?: string;
    }) => OpenAI;
    try {
      const mod = await import('openai');
      OpenAICtor = mod.OpenAI ?? mod.default;
    } catch {
      throw new Error(
        '@matthesketh/utopia-ai: "openai" package is required for the OpenAI adapter. ' +
          'Install it with: npm install openai',
      );
    }

    client = new OpenAICtor({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
    });
    return client;
  }

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const openai = await getClient();
      const model = request.model ?? config.defaultModel ?? 'gpt-4o';

      const body: Record<string, unknown> = {
        model,
        messages: toOpenAIMessages(request.messages),
        ...request.extra,
      };

      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
      if (request.topP !== undefined) body.top_p = request.topP;
      if (request.stop) body.stop = request.stop;

      if (request.tools?.length) {
        body.tools = request.tools.map(toOpenAITool);
        if (request.toolChoice) {
          body.tool_choice = toOpenAIToolChoice(request.toolChoice);
        }
      }

      // Cast needed: we build params dynamically but the SDK expects strict types
      const response = (await openai.chat.completions.create(
        body as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
      )) as OpenAI.ChatCompletion;

      if (!response.choices?.length) {
        throw new Error('OpenAI returned empty choices array');
      }
      const choice = response.choices[0];

      return {
        content: choice.message.content ?? '',
        toolCalls: choice.message.tool_calls?.map((tc) =>
          fromOpenAIToolCall(
            tc as unknown as { id: string; function: { name: string; arguments: string } },
          ),
        ),
        finishReason: mapFinishReason(choice.finish_reason),
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        raw: response,
      };
    },

    async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
      const openai = await getClient();
      const model = request.model ?? config.defaultModel ?? 'gpt-4o';

      const body: Record<string, unknown> = {
        model,
        messages: toOpenAIMessages(request.messages),
        stream: true,
        stream_options: { include_usage: true },
        ...request.extra,
      };

      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
      if (request.topP !== undefined) body.top_p = request.topP;
      if (request.stop) body.stop = request.stop;

      if (request.tools?.length) {
        body.tools = request.tools.map(toOpenAITool);
        if (request.toolChoice) {
          body.tool_choice = toOpenAIToolChoice(request.toolChoice);
        }
      }

      // Cast needed: we build params dynamically but the SDK expects strict types
      const stream = await openai.chat.completions.create(
        body as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
      );

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        const finishReason = chunk.choices?.[0]?.finish_reason;

        const chatChunk: ChatChunk = {
          delta: delta?.content ?? '',
        };

        if (delta?.tool_calls?.[0]) {
          const tc = delta.tool_calls[0];
          chatChunk.toolCallDelta = {
            index: tc.index,
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments ? tryParseJSON(tc.function.arguments) : undefined,
          };
        }

        if (finishReason) {
          chatChunk.finishReason = mapFinishReason(finishReason);
        }

        if (chunk.usage) {
          chatChunk.usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }

        yield chatChunk;
      }
    },

    async embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      const openai = await getClient();
      const model = request.model ?? 'text-embedding-3-small';

      const response = await openai.embeddings.create({
        model,
        input: request.input,
        ...request.extra,
      });

      return {
        embeddings: response.data.map((d: { embedding: number[] }) => d.embedding),
        usage: response.usage ? { totalTokens: response.usage.total_tokens } : undefined,
        raw: response,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Internal OpenAI-shaped types (avoids coupling to SDK version internals)
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: string;
  content?: string | Record<string, unknown>[] | null;
  name?: string;
  tool_calls?: OpenAIToolCallParam[];
  tool_call_id?: string;
}

interface OpenAIToolCallParam {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIToolParam {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages
    .map((msg) => {
      // Simple string content
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content, ...(msg.name ? { name: msg.name } : {}) };
      }

      // Array of content parts
      if (Array.isArray(msg.content)) {
        const toolCalls: OpenAIToolCallParam[] = [];
        const toolResults: { id: string; content: string }[] = [];
        const contentParts: Record<string, unknown>[] = [];

        for (const part of msg.content) {
          if (typeof part === 'string') {
            contentParts.push({ type: 'text', text: part });
          } else if (part.type === 'text') {
            contentParts.push({ type: 'text', text: part.text });
          } else if (part.type === 'image') {
            contentParts.push({
              type: 'image_url',
              image_url: { url: part.source },
            });
          } else if (part.type === 'tool_call') {
            toolCalls.push({
              id: part.id,
              type: 'function',
              function: { name: part.name, arguments: JSON.stringify(part.arguments) },
            });
          } else if (part.type === 'tool_result') {
            toolResults.push(part);
          }
        }

        // Tool call messages
        if (toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: contentParts.length > 0 ? contentParts : null,
            tool_calls: toolCalls,
          };
        }

        // Tool result messages
        if (toolResults.length > 0) {
          return toolResults.map((tr) => ({
            role: 'tool' as const,
            tool_call_id: tr.id,
            content: tr.content,
          }));
        }

        return { role: msg.role, content: contentParts };
      }

      // Single content object
      const part = msg.content;
      if (part.type === 'text') {
        return { role: msg.role, content: part.text };
      }

      return { role: msg.role, content: String(msg.content) };
    })
    .flat();
}

function toOpenAITool(tool: ToolDefinition): OpenAIToolParam {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  };
}

function toOpenAIToolChoice(
  choice: ChatRequest['toolChoice'],
): string | { type: string; function: { name: string } } | undefined {
  if (typeof choice === 'string') return choice;
  if (choice && typeof choice === 'object' && 'name' in choice) {
    return { type: 'function', function: { name: choice.name } };
  }
  return undefined;
}

function fromOpenAIToolCall(tc: {
  id: string;
  function: { name: string; arguments: string };
}): ToolCall {
  return {
    id: tc.id,
    name: tc.function.name,
    arguments: tryParseJSON(tc.function.arguments) ?? {},
  };
}

function mapFinishReason(reason: string): ChatResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'error';
    default:
      return 'stop';
  }
}

function tryParseJSON(str: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}
