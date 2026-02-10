// ============================================================================
// @matthesketh/utopia-ai — Google Gemini Adapter
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

import type {
  GoogleGenerativeAI as GoogleGenAIType,
  GenerateContentRequest,
  ModelParams,
  EmbedContentRequest,
} from '@google/generative-ai';

/** Monotonic counter for generating unique tool call IDs. */
let toolCallCounter = 0;

/**
 * Create a Google Gemini adapter.
 *
 * Requires `@google/generative-ai` as a peer dependency.
 *
 * ```ts
 * import { createAI } from '@matthesketh/utopia-ai';
 * import { googleAdapter } from '@matthesketh/utopia-ai/google';
 *
 * const ai = createAI(googleAdapter({ apiKey: process.env.GOOGLE_API_KEY }));
 * ```
 */
export function googleAdapter(config: GoogleConfig): AIAdapter {
  let genAI: GoogleGenAIType | null = null;

  async function getGenAI(): Promise<GoogleGenAIType> {
    if (genAI) return genAI;

    let GoogleGenerativeAI: new (apiKey: string) => GoogleGenAIType;
    try {
      const mod = await import('@google/generative-ai');
      GoogleGenerativeAI = mod.GoogleGenerativeAI;
    } catch {
      throw new Error(
        '@matthesketh/utopia-ai: "@google/generative-ai" package is required for the Google adapter. ' +
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

      const modelConfig: Record<string, unknown> = {};
      if (request.temperature !== undefined) modelConfig.temperature = request.temperature;
      if (request.maxTokens !== undefined) modelConfig.maxOutputTokens = request.maxTokens;
      if (request.topP !== undefined) modelConfig.topP = request.topP;
      if (request.stop) modelConfig.stopSequences = request.stop;

      // Cast needed: we build params dynamically but the SDK expects strict types
      const model = ai.getGenerativeModel({
        model: modelName,
        generationConfig: modelConfig,
        ...(request.tools?.length
          ? { tools: [{ functionDeclarations: request.tools.map(toGeminiTool) }] }
          : {}),
        ...request.extra,
      } as unknown as ModelParams);

      const { system, contents } = toGeminiContents(request.messages);

      const result = await model.generateContent({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      } as unknown as GenerateContentRequest);

      const response = result.response;
      const candidate = response.candidates?.[0];
      const parts = (candidate?.content?.parts ?? []) as unknown as GeminiPart[];

      const textParts = parts
        .filter((p) => 'text' in p && p.text)
        .map((p) => (p as { text: string }).text);
      const fnCalls = parts.filter((p) => 'functionCall' in p && p.functionCall);

      const toolCalls: ToolCall[] = fnCalls.map((p) => {
        const fc = (p as { functionCall: { name: string; args?: Record<string, unknown> } })
          .functionCall;
        return {
          id: `call_${++toolCallCounter}_${Date.now().toString(36)}`,
          name: fc.name,
          arguments: fc.args ?? {},
        };
      });

      return {
        content: textParts.join(''),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: mapFinishReason(candidate?.finishReason),
        usage: response.usageMetadata
          ? {
              promptTokens: response.usageMetadata.promptTokenCount ?? 0,
              completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
              totalTokens: response.usageMetadata.totalTokenCount ?? 0,
            }
          : undefined,
        raw: response,
      };
    },

    async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
      const ai = await getGenAI();
      const modelName = request.model ?? config.defaultModel ?? 'gemini-2.0-flash';

      const modelConfig: Record<string, unknown> = {};
      if (request.temperature !== undefined) modelConfig.temperature = request.temperature;
      if (request.maxTokens !== undefined) modelConfig.maxOutputTokens = request.maxTokens;
      if (request.topP !== undefined) modelConfig.topP = request.topP;
      if (request.stop) modelConfig.stopSequences = request.stop;

      // Cast needed: we build params dynamically but the SDK expects strict types
      const model = ai.getGenerativeModel({
        model: modelName,
        generationConfig: modelConfig,
        ...(request.tools?.length
          ? { tools: [{ functionDeclarations: request.tools.map(toGeminiTool) }] }
          : {}),
        ...request.extra,
      } as unknown as ModelParams);

      const { system, contents } = toGeminiContents(request.messages);

      const result = await model.generateContentStream({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      } as unknown as GenerateContentRequest);

      for await (const chunk of result.stream) {
        const parts = (chunk.candidates?.[0]?.content?.parts ?? []) as unknown as GeminiPart[];
        const text = parts
          .filter((p) => 'text' in p && p.text)
          .map((p) => (p as { text: string }).text)
          .join('');
        const finishReason = chunk.candidates?.[0]?.finishReason;

        yield {
          delta: text,
          finishReason: finishReason ? mapFinishReason(finishReason) : undefined,
          usage: chunk.usageMetadata
            ? {
                promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
                completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
                totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
              }
            : undefined,
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
        requests: inputs.map(
          (text) =>
            ({
              content: { parts: [{ text }], role: 'user' },
            }) as unknown as EmbedContentRequest,
        ),
      });

      return {
        embeddings: result.embeddings.map((e: { values: number[] }) => e.values),
        raw: result,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Internal Gemini-shaped types
// ---------------------------------------------------------------------------

type GeminiPart = Record<string, unknown>;

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toGeminiContents(messages: ChatMessage[]): { system?: string; contents: GeminiContent[] } {
  let system: string | undefined;
  const contents: GeminiContent[] = [];

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
      const parts: GeminiPart[] = [];

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

function toGeminiTool(tool: ToolDefinition): GeminiFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Record<string, unknown>,
  };
}

function mapFinishReason(reason?: string): ChatResponse['finishReason'] {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'OTHER':
      return 'stop';
    default:
      return 'stop';
  }
}
