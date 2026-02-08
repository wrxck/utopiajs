// ============================================================================
// @utopia/ai — OpenAI Adapter
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
  MessageContent,
} from '../types.js';

/**
 * Create an OpenAI adapter.
 *
 * Requires `openai` as a peer dependency.
 *
 * ```ts
 * import { createAI } from '@utopia/ai';
 * import { openaiAdapter } from '@utopia/ai/openai';
 *
 * const ai = createAI(openaiAdapter({ apiKey: process.env.OPENAI_API_KEY }));
 * ```
 */
export function openaiAdapter(config: OpenAIConfig): AIAdapter {
  let client: any = null;

  async function getClient(): Promise<any> {
    if (client) return client;

    let OpenAI: any;
    try {
      const mod = await import('openai');
      OpenAI = mod.OpenAI ?? mod.default;
    } catch {
      throw new Error(
        '@utopia/ai: "openai" package is required for the OpenAI adapter. ' +
        'Install it with: npm install openai',
      );
    }

    client = new OpenAI({
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

      const body: Record<string, any> = {
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

      const response = await openai.chat.completions.create(body);
      const choice = response.choices[0];

      return {
        content: choice.message.content ?? '',
        toolCalls: choice.message.tool_calls?.map(fromOpenAIToolCall),
        finishReason: mapFinishReason(choice.finish_reason),
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
        raw: response,
      };
    },

    async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
      const openai = await getClient();
      const model = request.model ?? config.defaultModel ?? 'gpt-4o';

      const body: Record<string, any> = {
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

      const stream = await openai.chat.completions.create(body);

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
        embeddings: response.data.map((d: any) => d.embedding),
        usage: response.usage ? { totalTokens: response.usage.total_tokens } : undefined,
        raw: response,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toOpenAIMessages(messages: ChatMessage[]): any[] {
  return messages.map((msg) => {
    // Simple string content
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content, ...(msg.name ? { name: msg.name } : {}) };
    }

    // Array of content parts
    if (Array.isArray(msg.content)) {
      const toolCalls: any[] = [];
      const toolResults: any[] = [];
      const contentParts: any[] = [];

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
        return toolResults.map((tr: any) => ({
          role: 'tool',
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
  }).flat();
}

function toOpenAITool(tool: ToolDefinition): any {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toOpenAIToolChoice(choice: ChatRequest['toolChoice']): any {
  if (typeof choice === 'string') return choice;
  if (choice && typeof choice === 'object' && 'name' in choice) {
    return { type: 'function', function: { name: choice.name } };
  }
  return choice;
}

function fromOpenAIToolCall(tc: any): ToolCall {
  return {
    id: tc.id,
    name: tc.function.name,
    arguments: tryParseJSON(tc.function.arguments) ?? {},
  };
}

function mapFinishReason(reason: string): ChatResponse['finishReason'] {
  switch (reason) {
    case 'stop': return 'stop';
    case 'tool_calls': return 'tool_calls';
    case 'length': return 'length';
    case 'content_filter': return 'error';
    default: return 'stop';
  }
}

function tryParseJSON(str: string): Record<string, unknown> | undefined {
  try { return JSON.parse(str); } catch { return undefined; }
}
