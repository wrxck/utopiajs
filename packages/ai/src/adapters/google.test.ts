// ============================================================================
// @matthesketh/utopia-ai — Google Gemini adapter tests (mocked SDK, no network)
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { googleAdapter } from './google';
import type { ChatChunk } from '../types';

const h = vi.hoisted(() => ({
  getModel: vi.fn(),
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
  batchEmbedContents: vi.fn(),
  apiKeys: [] as string[],
}));

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    constructor(apiKey: string) {
      h.apiKeys.push(apiKey);
    }
    getGenerativeModel = h.getModel;
  }
  return { GoogleGenerativeAI };
});

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

async function collect(iterable: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getModel.mockReturnValue({
    generateContent: h.generateContent,
    generateContentStream: h.generateContentStream,
    batchEmbedContents: h.batchEmbedContents,
  });
  h.generateContent.mockResolvedValue({
    response: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] },
  });
});

// ---------------------------------------------------------------------------
// chat()
// ---------------------------------------------------------------------------

describe('googleAdapter.chat', () => {
  it('passes the api key and default model to the SDK', async () => {
    const adapter = googleAdapter({ apiKey: 'g-key' });
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(h.apiKeys).toContain('g-key');
    expect(h.getModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.0-flash', generationConfig: {} }),
    );
  });

  it('maps sampling params, stop sequences, tools and model overrides', async () => {
    const adapter = googleAdapter({ apiKey: 'k', defaultModel: 'gemini-pro' });
    await adapter.chat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gemini-ultra',
      temperature: 0.3,
      maxTokens: 99,
      topP: 0.8,
      stop: ['END'],
      tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
      extra: { safetySettings: [] },
    });

    expect(h.getModel).toHaveBeenCalledWith({
      model: 'gemini-ultra',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 99,
        topP: 0.8,
        stopSequences: ['END'],
      },
      tools: [
        {
          functionDeclarations: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
        },
      ],
      safetySettings: [],
    });
  });

  it('uses the config defaultModel when the request has none', async () => {
    const adapter = googleAdapter({ apiKey: 'k', defaultModel: 'gemini-pro' });
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(h.getModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-pro' }));
  });

  it('maps a string system message to systemInstruction', async () => {
    const adapter = googleAdapter({ apiKey: 'k' });
    await adapter.chat({
      messages: [
        { role: 'system', content: 'be nice' },
        { role: 'user', content: 'hi' },
      ],
    });

    expect(h.generateContent).toHaveBeenCalledWith({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      systemInstruction: { parts: [{ text: 'be nice' }] },
    });
  });

  it('maps an array-content system message to systemInstruction instead of dropping it', async () => {
    const adapter = googleAdapter({ apiKey: 'k' });
    await adapter.chat({
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'be ' },
            { type: 'text', text: 'nice' },
          ],
        },
        { role: 'user', content: 'hi' },
      ],
    });

    expect(h.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ systemInstruction: { parts: [{ text: 'be nice' }] } }),
    );
  });

  it('maps roles, images, tool calls and tool results into Gemini contents', async () => {
    const adapter = googleAdapter({ apiKey: 'k' });
    await adapter.chat({
      messages: [
        {
          role: 'user',
          content: [
            'raw',
            { type: 'text', text: 'typed' },
            { type: 'image', source: 'B64', mediaType: 'image/jpeg' },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_call', id: 'c1', name: 'fn', arguments: { a: 1 } }],
        },
        {
          role: 'tool',
          content: [{ type: 'tool_result', id: 'c1', content: '{"out":2}' }],
        },
        { role: 'user', content: { type: 'text', text: 'single' } },
      ],
    });

    const { contents } = h.generateContent.mock.calls[0][0];
    expect(contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'raw' },
          { text: 'typed' },
          { inlineData: { mimeType: 'image/jpeg', data: 'B64' } },
        ],
      },
      { role: 'model', parts: [{ functionCall: { name: 'fn', args: { a: 1 } } }] },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'c1', response: { content: '{"out":2}' } } }],
      },
      { role: 'user', parts: [{ text: 'single' }] },
    ]);
  });

  it('maps text parts, function calls, finish reason and usage from the response', async () => {
    h.generateContent.mockResolvedValueOnce({
      response: {
        candidates: [
          {
            content: {
              parts: [
                { text: 'The answer ' },
                { text: 'is 42.' },
                { functionCall: { name: 'lookup', args: { q: 'x' } } },
                { functionCall: { name: 'noargs' } },
              ],
            },
            finishReason: 'MAX_TOKENS',
          },
        ],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 22, totalTokenCount: 33 },
      },
    });

    const adapter = googleAdapter({ apiKey: 'k' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'q' }] });

    expect(res.content).toBe('The answer is 42.');
    expect(res.finishReason).toBe('length');
    expect(res.toolCalls).toHaveLength(2);
    expect(res.toolCalls![0].name).toBe('lookup');
    expect(res.toolCalls![0].arguments).toEqual({ q: 'x' });
    expect(res.toolCalls![1].arguments).toEqual({});
    expect(res.toolCalls![0].id).not.toBe(res.toolCalls![1].id);
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 22, totalTokens: 33 });
  });

  it('handles missing candidates and missing usage gracefully', async () => {
    h.generateContent.mockResolvedValueOnce({ response: {} });

    const adapter = googleAdapter({ apiKey: 'k' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'q' }] });

    expect(res.content).toBe('');
    expect(res.toolCalls).toBeUndefined();
    expect(res.finishReason).toBe('stop');
    expect(res.usage).toBeUndefined();
  });

  it('creates the SDK client once and reuses it', async () => {
    const adapter = googleAdapter({ apiKey: 'cache-key' });
    await adapter.chat({ messages: [{ role: 'user', content: 'a' }] });
    await adapter.chat({ messages: [{ role: 'user', content: 'b' }] });
    expect(h.apiKeys.filter((k) => k === 'cache-key')).toHaveLength(1);
  });

  it('defaults usage token counts to 0 when usageMetadata is sparse', async () => {
    h.generateContent.mockResolvedValueOnce({
      response: {
        candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
        usageMetadata: {},
      },
    });

    const adapter = googleAdapter({ apiKey: 'k' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'q' }] });
    expect(res.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('defaults image mimeType to image/png and ignores unknown part types', async () => {
    const adapter = googleAdapter({ apiKey: 'k' });
    await adapter.chat({
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: 'B64' }, { type: 'weird' } as never],
        },
        { role: 'user', content: { type: 'image', source: 'dropped' } },
      ],
    });

    const { contents } = h.generateContent.mock.calls[0][0];
    expect(contents).toEqual([
      { role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'B64' } }] },
    ]);
  });

  it('maps SAFETY finish reason to stop', async () => {
    h.generateContent.mockResolvedValueOnce({
      response: { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] },
    });

    const adapter = googleAdapter({ apiKey: 'k' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'q' }] });
    expect(res.finishReason).toBe('stop');
  });
});

// ---------------------------------------------------------------------------
// stream()
// ---------------------------------------------------------------------------

describe('googleAdapter.stream', () => {
  it('yields deltas, finish reason and usage from the SDK stream', async () => {
    h.generateContentStream.mockResolvedValueOnce({
      stream: asyncIter([
        { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'lo' }] } }] },
        {
          candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
        },
      ]),
    });

    const adapter = googleAdapter({ apiKey: 'k' });
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'q' }] }));

    expect(chunks.map((c) => c.delta)).toEqual(['Hel', 'lo', '']);
    expect(chunks[0].finishReason).toBeUndefined();
    expect(chunks[2].finishReason).toBe('stop');
    expect(chunks[2].usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
  });

  it('tolerates chunks without candidates and sparse usage metadata', async () => {
    h.generateContentStream.mockResolvedValueOnce({
      stream: asyncIter([{}, { candidates: [{ content: { parts: [] } }], usageMetadata: {} }]),
    });

    const adapter = googleAdapter({ apiKey: 'k' });
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'q' }] }));

    expect(chunks[0].delta).toBe('');
    expect(chunks[0].usage).toBeUndefined();
    expect(chunks[1].usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('passes system instruction and generation config to the streaming call', async () => {
    h.generateContentStream.mockResolvedValueOnce({ stream: asyncIter([]) });

    const adapter = googleAdapter({ apiKey: 'k' });
    await collect(
      adapter.stream!({
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'q' },
        ],
        temperature: 0.2,
        maxTokens: 5,
        topP: 0.7,
        stop: ['x'],
        tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
      }),
    );

    expect(h.getModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: { temperature: 0.2, maxOutputTokens: 5, topP: 0.7, stopSequences: ['x'] },
      }),
    );
    expect(h.generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({ systemInstruction: { parts: [{ text: 'sys' }] } }),
    );
  });
});

// ---------------------------------------------------------------------------
// embeddings()
// ---------------------------------------------------------------------------

describe('googleAdapter.embeddings', () => {
  it('batch-embeds each input and returns the vectors', async () => {
    h.batchEmbedContents.mockResolvedValueOnce({
      embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
    });

    const adapter = googleAdapter({ apiKey: 'k' });
    const res = await adapter.embeddings!({ input: ['a', 'b'] });

    expect(h.getModel).toHaveBeenCalledWith({ model: 'text-embedding-004' });
    expect(h.batchEmbedContents).toHaveBeenCalledWith({
      requests: [
        { content: { parts: [{ text: 'a' }], role: 'user' } },
        { content: { parts: [{ text: 'b' }], role: 'user' } },
      ],
    });
    expect(res.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it('wraps a single string input and honours a custom model', async () => {
    h.batchEmbedContents.mockResolvedValueOnce({ embeddings: [{ values: [1] }] });

    const adapter = googleAdapter({ apiKey: 'k' });
    const res = await adapter.embeddings!({ input: 'solo', model: 'custom-embed' });

    expect(h.getModel).toHaveBeenCalledWith({ model: 'custom-embed' });
    expect(res.embeddings).toEqual([[1]]);
  });
});
