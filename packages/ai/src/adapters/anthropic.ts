// ============================================================================
// @matthesketh/utopia-ai — Anthropic Adapter
// ============================================================================

import type {
  AIAdapter,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
  AnthropicConfig,
  ToolCall,
  ToolDefinition,
} from '../types.js';

/**
 * Create an Anthropic adapter.
 *
 * Requires `@anthropic-ai/sdk` as a peer dependency.
 *
 * ```ts
 * import { createAI } from '@matthesketh/utopia-ai';
 * import { anthropicAdapter } from '@matthesketh/utopia-ai/anthropic';
 *
 * const ai = createAI(anthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY }));
 * ```
 */
export function anthropicAdapter(config: AnthropicConfig): AIAdapter {
  let client: any = null;

  async function getClient(): Promise<any> {
    if (client) return client;

    let Anthropic: any;
    try {
      const mod = await import('@anthropic-ai/sdk');
      Anthropic = mod.Anthropic ?? mod.default;
    } catch {
      throw new Error(
        '@matthesketh/utopia-ai: "@anthropic-ai/sdk" package is required for the Anthropic adapter. ' +
        'Install it with: npm install @anthropic-ai/sdk',
      );
    }

    client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return client;
  }

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const anthropic = await getClient();
      const model = request.model ?? config.defaultModel ?? 'claude-sonnet-4-5-20250929';

      const { system, messages } = toAnthropicMessages(request.messages);

      const body: Record<string, any> = {
        model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        ...request.extra,
      };

      if (system) body.system = system;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.topP !== undefined) body.top_p = request.topP;
      if (request.stop) body.stop_sequences = request.stop;

      if (request.tools?.length) {
        body.tools = request.tools.map(toAnthropicTool);
        if (request.toolChoice) {
          body.tool_choice = toAnthropicToolChoice(request.toolChoice);
        }
      }

      const response = await anthropic.messages.create(body);

      const textContent = response.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');

      const toolCalls = response.content
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any): ToolCall => ({
          id: b.id,
          name: b.name,
          arguments: b.input ?? {},
        }));

      return {
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: mapStopReason(response.stop_reason),
        usage: response.usage ? {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        } : undefined,
        raw: response,
      };
    },

    async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
      const anthropic = await getClient();
      const model = request.model ?? config.defaultModel ?? 'claude-sonnet-4-5-20250929';

      const { system, messages } = toAnthropicMessages(request.messages);

      const body: Record<string, any> = {
        model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
        ...request.extra,
      };

      if (system) body.system = system;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.topP !== undefined) body.top_p = request.topP;
      if (request.stop) body.stop_sequences = request.stop;

      if (request.tools?.length) {
        body.tools = request.tools.map(toAnthropicTool);
        if (request.toolChoice) {
          body.tool_choice = toAnthropicToolChoice(request.toolChoice);
        }
      }

      const stream = anthropic.messages.stream(body);

      let promptTokens = 0;

      for await (const event of stream) {
        if (event.type === 'message_start' && event.message?.usage) {
          promptTokens = event.message.usage.input_tokens ?? 0;
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { delta: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            yield {
              delta: '',
              toolCallDelta: {
                arguments: tryParseJSON(event.delta.partial_json),
              },
            };
          }
        } else if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            yield {
              delta: '',
              toolCallDelta: {
                id: event.content_block.id,
                name: event.content_block.name,
                index: event.index,
              },
            };
          }
        } else if (event.type === 'message_delta') {
          const outputTokens = event.usage?.output_tokens ?? 0;
          yield {
            delta: '',
            finishReason: mapStopReason(event.delta.stop_reason),
            usage: event.usage ? {
              promptTokens,
              completionTokens: outputTokens,
              totalTokens: promptTokens + outputTokens,
            } : undefined,
          };
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toAnthropicMessages(messages: ChatMessage[]): { system?: string; messages: any[] } {
  let system: string | undefined;
  const out: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => typeof c === 'string' ? c : 'text' in c ? c.text : '').join('')
          : 'text' in msg.content ? msg.content.text : '';
      continue;
    }

    if (typeof msg.content === 'string') {
      out.push({ role: msg.role === 'tool' ? 'user' : msg.role, content: msg.content });
      continue;
    }

    if (Array.isArray(msg.content)) {
      const blocks: any[] = [];

      for (const part of msg.content) {
        if (typeof part === 'string') {
          blocks.push({ type: 'text', text: part });
        } else if (part.type === 'text') {
          blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'image') {
          blocks.push({
            type: 'image',
            source: {
              type: part.source.startsWith('data:') || part.source.startsWith('http') ? 'url' : 'base64',
              ...(part.source.startsWith('data:') || part.source.startsWith('http')
                ? { url: part.source }
                : { media_type: part.mediaType ?? 'image/png', data: part.source }),
            },
          });
        } else if (part.type === 'tool_call') {
          blocks.push({
            type: 'tool_use',
            id: part.id,
            name: part.name,
            input: part.arguments,
          });
        } else if (part.type === 'tool_result') {
          blocks.push({
            type: 'tool_result',
            tool_use_id: part.id,
            content: part.content,
            is_error: part.isError,
          });
        }
      }

      // Tool results go in 'user' role for Anthropic
      const role = msg.role === 'tool' ? 'user' : msg.role;
      out.push({ role, content: blocks });
      continue;
    }

    // Single content object
    const part = msg.content;
    if (part.type === 'text') {
      out.push({ role: msg.role, content: part.text });
    }
  }

  return { system, messages: out };
}

function toAnthropicTool(tool: ToolDefinition): any {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

function toAnthropicToolChoice(choice: ChatRequest['toolChoice']): any {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  if (choice && typeof choice === 'object' && 'name' in choice) {
    return { type: 'tool', name: choice.name };
  }
  return { type: 'auto' };
}

function mapStopReason(reason: string): ChatResponse['finishReason'] {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'stop_sequence': return 'stop';
    case 'tool_use': return 'tool_calls';
    case 'max_tokens': return 'length';
    default: return 'stop';
  }
}

function tryParseJSON(str: string): Record<string, unknown> | undefined {
  try { return JSON.parse(str); } catch { return undefined; }
}
