// ============================================================================
// @utopia/ai — Google Gemini Adapter
// ============================================================================

import type {
  AIAdapter,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
  GoogleConfig,
  ToolCall,
  ToolDefinition,
} from '../types.js';

/**
 * Create a Google Gemini adapter.
 *
 * Requires `@google/generative-ai` as a peer dependency.
 *
 * ```ts
 * import { createAI } from '@utopia/ai';
 * import { googleAdapter } from '@utopia/ai/google';
 *
 * const ai = createAI(googleAdapter({ apiKey: process.env.GOOGLE_API_KEY }));
 * ```
 */
export function googleAdapter(config: GoogleConfig): AIAdapter {
  let genAI: any = null;

  async function getGenAI(): Promise<any> {
    if (genAI) return genAI;

    let GoogleGenerativeAI: any;
    try {
      const mod = await import('@google/generative-ai');
      GoogleGenerativeAI = mod.GoogleGenerativeAI;
    } catch {
      throw new Error(
        '@utopia/ai: "@google/generative-ai" package is required for the Google adapter. ' +
        'Install it with: npm install @google/generative-ai',
      );
    }

    genAI = new GoogleGenerativeAI(config.apiKey);
    return genAI;
  }

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const ai = await getGenAI();
      const modelName = request.model ?? config.defaultModel ?? 'gemini-2.0-flash';

      const modelConfig: Record<string, any> = {};
      if (request.temperature !== undefined) modelConfig.temperature = request.temperature;
      if (request.maxTokens !== undefined) modelConfig.maxOutputTokens = request.maxTokens;
      if (request.topP !== undefined) modelConfig.topP = request.topP;
      if (request.stop) modelConfig.stopSequences = request.stop;

      const model = ai.getGenerativeModel({
        model: modelName,
        generationConfig: modelConfig,
        ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map(toGeminiTool) }] } : {}),
        ...request.extra,
      });

      const { system, contents } = toGeminiContents(request.messages);

      const result = await model.generateContent({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      });

      const response = result.response;
      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
      const fnCalls = parts.filter((p: any) => p.functionCall);

      const toolCalls: ToolCall[] = fnCalls.map((p: any) => ({
        id: `call_${crypto.randomUUID()}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args ?? {},
      }));

      return {
        content: textParts.join(''),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: mapFinishReason(candidate?.finishReason),
        usage: response.usageMetadata ? {
          promptTokens: response.usageMetadata.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata.totalTokenCount ?? 0,
        } : undefined,
        raw: response,
      };
    },

    async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
      const ai = await getGenAI();
      const modelName = request.model ?? config.defaultModel ?? 'gemini-2.0-flash';

      const modelConfig: Record<string, any> = {};
      if (request.temperature !== undefined) modelConfig.temperature = request.temperature;
      if (request.maxTokens !== undefined) modelConfig.maxOutputTokens = request.maxTokens;
      if (request.topP !== undefined) modelConfig.topP = request.topP;
      if (request.stop) modelConfig.stopSequences = request.stop;

      const model = ai.getGenerativeModel({
        model: modelName,
        generationConfig: modelConfig,
        ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map(toGeminiTool) }] } : {}),
        ...request.extra,
      });

      const { system, contents } = toGeminiContents(request.messages);

      const result = await model.generateContentStream({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      });

      for await (const chunk of result.stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
        const finishReason = chunk.candidates?.[0]?.finishReason;

        yield {
          delta: text,
          finishReason: finishReason ? mapFinishReason(finishReason) : undefined,
          usage: chunk.usageMetadata ? {
            promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          } : undefined,
        };
      }
    },

    async embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      const ai = await getGenAI();
      const model = ai.getGenerativeModel({
        model: request.model ?? 'text-embedding-004',
      });

      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      const result = await model.batchEmbedContents({
        requests: inputs.map((text) => ({
          content: { parts: [{ text }] },
        })),
      });

      return {
        embeddings: result.embeddings.map((e: any) => e.values),
        raw: result,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toGeminiContents(messages: ChatMessage[]): { system?: string; contents: any[] } {
  let system: string | undefined;
  const contents: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = typeof msg.content === 'string' ? msg.content : '';
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      contents.push({ role, parts: [{ text: msg.content }] });
      continue;
    }

    if (Array.isArray(msg.content)) {
      const parts: any[] = [];

      for (const part of msg.content) {
        if (typeof part === 'string') {
          parts.push({ text: part });
        } else if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if (part.type === 'image') {
          parts.push({
            inlineData: {
              mimeType: part.mediaType ?? 'image/png',
              data: part.source,
            },
          });
        } else if (part.type === 'tool_call') {
          parts.push({
            functionCall: { name: part.name, args: part.arguments },
          });
        } else if (part.type === 'tool_result') {
          parts.push({
            functionResponse: {
              name: part.id,
              response: { content: part.content },
            },
          });
        }
      }

      contents.push({ role, parts });
      continue;
    }

    const part = msg.content;
    if (part.type === 'text') {
      contents.push({ role, parts: [{ text: part.text }] });
    }
  }

  return { system, contents };
}

function toGeminiTool(tool: ToolDefinition): any {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function mapFinishReason(reason?: string): ChatResponse['finishReason'] {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'OTHER': return 'stop';
    default: return 'stop';
  }
}
