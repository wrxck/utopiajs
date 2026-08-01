// ============================================================================
// @matthesketh/utopia-ai — Anthropic adapter tests (mocked SDK, no network)
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatChunk } from '../types';
import { anthropicAdapter } from './anthropic';

const h = vi.hoisted(() => ({
  msgCreate: vi.fn(),
  msgStream: vi.fn(),
  ctorOpts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create: h.msgCreate, stream: h.msgStream };
    constructor(opts: Record<string, unknown>) {
      h.ctorOpts.push(opts);
    }
  }
  return { Anthropic, default: Anthropic };
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
  h.ctorOpts.length = 0;
  h.msgCreate.mockResolvedValue({
    content: [{ type: 'text', text: 'hello' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 3, output_tokens: 2 },
  });
});

// ---------------------------------------------------------------------------
// Client construction
// ---------------------------------------------------------------------------

describe('anthropicAdapter client construction', () => {
  it('passes apiKey (and only sets baseURL when configured), caching the client', async () => {
    const adapter = anthropicAdapter({ apiKey: 'sk-ant' });
    await adapter.chat({ messages: [{ role: 'user', content: 'a' }] });
    await adapter.chat({ messages: [{ role: 'user', content: 'b' }] });

    expect(h.ctorOpts).toHaveLength(1);
    expect(h.ctorOpts[0]).toEqual({ apiKey: 'sk-ant' });
  });

  it('passes a configured baseURL through', async () => {
    const adapter = anthropicAdapter({ apiKey: 'sk-ant', baseURL: 'https://gw.example.com' });
    await adapter.chat({ messages: [{ role: 'user', content: 'a' }] });
    expect(h.ctorOpts[0]).toEqual({ apiKey: 'sk-ant', baseURL: 'https://gw.example.com' });
  });

  it('rejects a non-http(s) baseURL', async () => {
    const adapter = anthropicAdapter({ apiKey: 'sk-ant', baseURL: 'file:///x' });
    await expect(adapter.chat({ messages: [{ role: 'user', content: 'a' }] })).rejects.toThrow(
      'Anthropic baseURL must be http(s): file:///x',
    );
  });
});

// ---------------------------------------------------------------------------
// chat()
// ---------------------------------------------------------------------------

describe('anthropicAdapter.chat', () => {
  it('sends defaults (model, max_tokens) and maps a text response', async () => {
    const adapter = anthropicAdapter({ apiKey: 'sk' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(h.msgCreate).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-5-20250929',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 4096,
    });
    expect(res.content).toBe('hello');
    expect(res.finishReason).toBe('stop');
    expect(res.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
  });

  it('maps params, system, tools, toolChoice and extra into the body', async () => {
    const adapter = anthropicAdapter({ apiKey: 'sk', defaultModel: 'claude-x' });
    await adapter.chat({
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
      temperature: 0.2,
      maxTokens: 100,
      topP: 0.9,
      stop: ['STOP'],
      tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
      toolChoice: 'required',
      extra: { metadata: { user_id: 'u1' } },
    });

    const body = h.msgCreate.mock.calls[0][0];
    expect(body.model).toBe('claude-x');
    expect(body.system).toBe('be terse');
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.2);
    expect(body.top_p).toBe(0.9);
    expect(body.stop_sequences).toEqual(['STOP']);
    expect(body.metadata).toEqual({ user_id: 'u1' });
    expect(body.tools).toEqual([
      { name: 'fn', description: 'd', input_schema: { type: 'object' } },
    ]);
    expect(body.tool_choice).toEqual({ type: 'any' });
  });

  it('maps each toolChoice variant', async () => {
    const adapter = anthropicAdapter({ apiKey: 'sk' });
    const tools = [{ name: 'fn', description: 'd', parameters: { type: 'object' } }];

    const cases: Array<[unknown, unknown]> = [
      ['auto', { type: 'auto' }],
      ['none', { type: 'none' }],
      [{ name: 'fn' }, { type: 'tool', name: 'fn' }],
    ];
    for (const [choice, expected] of cases) {
      h.msgCreate.mockClear();
      await adapter.chat({
        messages: [{ role: 'user', content: 'x' }],
        tools,
        toolChoice: choice as never,
      });
      expect(h.msgCreate.mock.calls[0][0].tool_choice).toEqual(expected);
    }
  });

  it('omits tool_choice when tools are set without a toolChoice (chat and stream)', async () => {
    const adapter = anthropicAdapter({ apiKey: 'sk' });
    const tools = [{ name: 'fn', description: 'd', parameters: { type: 'object' } }];

    await adapter.chat({ messages: [{ role: 'user', content: 'x' }], tools });
    expect('tool_choice' in h.msgCreate.mock.calls[0][0]).toBe(false);

    h.msgStream.mockReturnValueOnce(asyncIter([]));
    for await (const chunk of adapter.stream!({
      messages: [{ role: 'user', content: 'x' }],
      tools,
    })) {
      void chunk;
    }
    expect('tool_choice' in h.msgStream.mock.calls[0][0]).toBe(false);
  });

  it('maps an unrecognized toolChoice object to auto', async () => {
    const adapter = anthropicAdapter({ apiKey: 'sk' });
    await adapter.chat({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
      toolChoice: {} as never,
    });
    expect(h.msgCreate.mock.calls[0][0].tool_choice).toEqual({ type: 'auto' });
  });

  it('joins text blocks and maps tool_use blocks to toolCalls', async () => {
    h.msgCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Let me check. ' },
        { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'NYC' } },
        { type: 'text', text: 'One moment.' },
        { type: 'tool_use', id: 'tu_2', name: 'noinput', input: null },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const adapter = anthropicAdapter({ apiKey: 'sk' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'weather?' }] });

    expect(res.content).toBe('Let me check. One moment.');
    expect(res.finishReason).toBe('tool_calls');
    expect(res.toolCalls).toEqual([
      { id: 'tu_1', name: 'get_weather', arguments: { city: 'NYC' } },
      { id: 'tu_2', name: 'noinput', arguments: {} },
    ]);
  });

  it('maps stop reasons: stop_sequence, max_tokens, null', async () => {
    const adapter = anthropicAdapter({ apiKey: 'sk' });

    h.msgCreate.mockResolvedValueOnce({ content: [], stop_reason: 'stop_sequence' });
    expect((await adapter.chat({ messages: [] })).finishReason).toBe('stop');

    h.msgCreate.mockResolvedValueOnce({ content: [], stop_reason: 'max_tokens' });
    expect((await adapter.chat({ messages: [] })).finishReason).toBe('length');

    h.msgCreate.mockResolvedValueOnce({ content: [], stop_reason: null });
    expect((await adapter.chat({ messages: [] })).finishReason).toBe('stop');
  });

  it('throws when the response has no content array', async () => {
    h.msgCreate.mockResolvedValueOnce({ content: 'not-an-array' });

    const adapter = anthropicAdapter({ apiKey: 'sk' });
    await expect(adapter.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      'Anthropic returned invalid response: missing content array',
    );
  });

  it('omits usage when the provider omits it', async () => {
    h.msgCreate.mockResolvedValueOnce({ content: [], stop_reason: 'end_turn', usage: null });

    const adapter = anthropicAdapter({ apiKey: 'sk' });
    const res = await adapter.chat({ messages: [] });
    expect(res.usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Message mapping
// ---------------------------------------------------------------------------

describe('anthropicAdapter message mapping', () => {
  async function sentBody(
    messages: Parameters<ReturnType<typeof anthropicAdapter>['chat']>[0]['messages'],
  ) {
    const adapter = anthropicAdapter({ apiKey: 'sk' });
    await adapter.chat({ messages });
    return h.msgCreate.mock.calls[0][0];
  }

  it('extracts an array-content system message', async () => {
    const body = await sentBody([
      {
        role: 'system',
        content: [
          { type: 'text', text: 'be ' },
          { type: 'text', text: 'nice' },
        ],
      },
      { role: 'user', content: 'hi' },
    ]);
    expect(body.system).toBe('be nice');
  });

  it('extracts a single-object system message', async () => {
    const body = await sentBody([
      { role: 'system', content: { type: 'text', text: 'sys' } },
      { role: 'user', content: 'hi' },
    ]);
    expect(body.system).toBe('sys');
  });

  it('maps tool role with string content to user role', async () => {
    const body = await sentBody([{ role: 'tool', content: 'result text' }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'result text' }]);
  });

  it('maps text, base64 image, url image, tool_call and tool_result parts', async () => {
    const body = await sentBody([
      {
        role: 'user',
        content: [
          'raw',
          { type: 'text', text: 'typed' },
          { type: 'image', source: 'iVBORbase64', mediaType: 'image/jpeg' },
          { type: 'image', source: 'https://img.example/cat.png' },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_call', id: 'tu_1', name: 'fn', arguments: { a: 1 } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', id: 'tu_1', content: 'out', isError: true }],
      },
    ]);

    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'raw' },
          { type: 'text', text: 'typed' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: 'iVBORbase64' },
          },
          { type: 'image', source: { type: 'url', url: 'https://img.example/cat.png' } },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'fn', input: { a: 1 } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'out', is_error: true }],
      },
    ]);
  });

  it('defaults base64 images to image/png when no mediaType is given', async () => {
    const body = await sentBody([{ role: 'user', content: [{ type: 'image', source: 'AAAA' }] }]);
    expect(body.messages[0].content[0].source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: 'AAAA',
    });
  });

  it('maps a single text content object', async () => {
    const body = await sentBody([{ role: 'user', content: { type: 'text', text: 'solo' } }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'solo' }]);
  });

  it('sends data: URIs as url image sources (current behavior)', async () => {
    // Note: the Anthropic API may reject data: URIs in url sources; this test
    // documents the current mapping — see the review notes for the flag.
    const body = await sentBody([
      { role: 'user', content: [{ type: 'image', source: 'data:image/png;base64,AAAA' }] },
    ]);
    expect(body.messages[0].content[0].source).toEqual({
      type: 'url',
      url: 'data:image/png;base64,AAAA',
    });
  });

  it('ignores unknown array part types', async () => {
    const body = await sentBody([
      { role: 'user', content: [{ type: 'weird' } as never, { type: 'text', text: 'kept' }] },
    ]);
    expect(body.messages[0].content).toEqual([{ type: 'text', text: 'kept' }]);
  });

  it('drops a message whose single content object is not text', async () => {
    const body = await sentBody([
      { role: 'user', content: { type: 'image', source: 'x' } },
      { role: 'user', content: 'still here' },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: 'still here' }]);
  });
});

// ---------------------------------------------------------------------------
// stream()
// ---------------------------------------------------------------------------

describe('anthropicAdapter.stream', () => {
  it('yields text deltas, tool-use starts, argument deltas, finish and usage', async () => {
    h.msgStream.mockReturnValueOnce(
      asyncIter([
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tu_1', name: 'fn' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"a":1}' },
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 7 },
        },
      ]),
    );

    const adapter = anthropicAdapter({ apiKey: 'sk' });
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'q' }] }));

    const body = h.msgStream.mock.calls[0][0];
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);

    expect(chunks.map((c) => c.delta)).toEqual(['Hel', 'lo', '', '', '']);
    expect(chunks[2].toolCallDelta).toEqual({ id: 'tu_1', name: 'fn', index: 1 });
    expect(chunks[3].toolCallDelta).toEqual({ arguments: { a: 1 } });

    const final = chunks[4];
    expect(final.finishReason).toBe('tool_calls');
    expect(final.usage).toEqual({ promptTokens: 10, completionTokens: 7, totalTokens: 17 });
  });

  it('tolerates message_start without usage and unknown event types', async () => {
    h.msgStream.mockReturnValueOnce(
      asyncIter([
        { type: 'message_start' },
        { type: 'message_start', message: {} },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
        { type: 'message_stop' },
        { type: 'message_delta', delta: {} },
        { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: {} },
      ]),
    );

    const adapter = anthropicAdapter({ apiKey: 'sk' });
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'q' }] }));

    expect(chunks).toHaveLength(3);
    // message_delta without usage yields no usage and a default stop reason
    expect(chunks[1]).toEqual({ delta: '', finishReason: 'stop', usage: undefined });
    expect(chunks[2].finishReason).toBe('length');
    // usage present but empty — token counts default to 0
    expect(chunks[2].usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('defaults prompt tokens to 0 when message_start usage lacks input_tokens', async () => {
    h.msgStream.mockReturnValueOnce(
      asyncIter([
        { type: 'message_start', message: { usage: {} } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      ]),
    );

    const adapter = anthropicAdapter({ apiKey: 'sk' });
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'q' }] }));
    expect(chunks[0].usage).toEqual({ promptTokens: 0, completionTokens: 2, totalTokens: 2 });
  });

  it('ignores non-tool content_block_start events and maps stream params', async () => {
    h.msgStream.mockReturnValueOnce(
      asyncIter([
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: null },
      ]),
    );

    const adapter = anthropicAdapter({ apiKey: 'sk' });
    const chunks = await collect(
      adapter.stream!({
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'q' },
        ],
        temperature: 0.3,
        topP: 0.6,
        maxTokens: 20,
        stop: ['s'],
        tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
        toolChoice: 'auto',
      }),
    );

    const body = h.msgStream.mock.calls[0][0];
    expect(body.system).toBe('sys');
    expect(body.temperature).toBe(0.3);
    expect(body.top_p).toBe(0.6);
    expect(body.max_tokens).toBe(20);
    expect(body.stop_sequences).toEqual(['s']);
    expect(body.tool_choice).toEqual({ type: 'auto' });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].finishReason).toBe('stop');
    expect(chunks[0].usage).toBeUndefined();
  });
});
