// ============================================================================
// @matthesketh/utopia-ai — OpenAI adapter tests (mocked SDK, no network)
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatChunk } from '../types';
import { openaiAdapter } from './openai';

const h = vi.hoisted(() => ({
  chatCreate: vi.fn(),
  embedCreate: vi.fn(),
  ctorOpts: [] as Array<Record<string, unknown>>,
}));

vi.mock('openai', () => {
  class OpenAI {
    chat = { completions: { create: h.chatCreate } };
    embeddings = { create: h.embedCreate };
    constructor(opts: Record<string, unknown>) {
      h.ctorOpts.push(opts);
    }
  }
  return { OpenAI, default: OpenAI };
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

function basicCompletion(overrides: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ctorOpts.length = 0;
  h.chatCreate.mockResolvedValue(basicCompletion());
});

// ---------------------------------------------------------------------------
// Client construction
// ---------------------------------------------------------------------------

describe('openaiAdapter client construction', () => {
  it('passes apiKey, baseURL and organization to the SDK and caches the client', async () => {
    const adapter = openaiAdapter({
      apiKey: 'sk-test',
      baseURL: 'https://proxy.example.com/v1',
      organization: 'org-1',
    });

    await adapter.chat({ messages: [{ role: 'user', content: 'a' }] });
    await adapter.chat({ messages: [{ role: 'user', content: 'b' }] });

    expect(h.ctorOpts).toHaveLength(1);
    expect(h.ctorOpts[0]).toEqual({
      apiKey: 'sk-test',
      baseURL: 'https://proxy.example.com/v1',
      organization: 'org-1',
    });
  });

  it('rejects a non-http(s) baseURL', async () => {
    const adapter = openaiAdapter({ apiKey: 'sk', baseURL: 'file:///etc/passwd' });
    await expect(adapter.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      'OpenAI baseURL must be http(s): file:///etc/passwd',
    );
  });
});

// ---------------------------------------------------------------------------
// chat()
// ---------------------------------------------------------------------------

describe('openaiAdapter.chat', () => {
  it('sends defaults and maps a plain text response', async () => {
    h.chatCreate.mockResolvedValueOnce(
      basicCompletion({
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
      }),
    );

    const adapter = openaiAdapter({ apiKey: 'sk' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(h.chatCreate).toHaveBeenCalledWith({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('hello');
    expect(res.finishReason).toBe('stop');
    expect(res.usage).toEqual({ promptTokens: 9, completionTokens: 4, totalTokens: 13 });
    expect(res.raw).toBeDefined();
  });

  it('maps sampling params, stop, tools, toolChoice and extra into the body', async () => {
    const adapter = openaiAdapter({ apiKey: 'sk', defaultModel: 'gpt-4o-mini' });
    await adapter.chat({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
      maxTokens: 50,
      topP: 0.95,
      stop: ['DONE'],
      tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
      toolChoice: { name: 'fn' },
      extra: { seed: 42 },
    });

    const body = h.chatCreate.mock.calls[0][0];
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(50);
    expect(body.top_p).toBe(0.95);
    expect(body.stop).toEqual(['DONE']);
    expect(body.seed).toBe(42);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'fn', description: 'd', parameters: { type: 'object' } },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'fn' } });
  });

  it('passes string toolChoice values through unchanged', async () => {
    const adapter = openaiAdapter({ apiKey: 'sk' });
    await adapter.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
      toolChoice: 'required',
    });

    expect(h.chatCreate.mock.calls[0][0].tool_choice).toBe('required');
  });

  it('maps tool calls, parsing JSON arguments and defaulting malformed ones to {}', async () => {
    h.chatCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'c1', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } },
              { id: 'c2', function: { name: 'broken', arguments: '{oops' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });

    const adapter = openaiAdapter({ apiKey: 'sk' });
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(res.content).toBe('');
    expect(res.finishReason).toBe('tool_calls');
    expect(res.toolCalls).toEqual([
      { id: 'c1', name: 'get_weather', arguments: { city: 'NYC' } },
      { id: 'c2', name: 'broken', arguments: {} },
    ]);
  });

  it('maps length and content_filter finish reasons', async () => {
    const adapter = openaiAdapter({ apiKey: 'sk' });

    h.chatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'x' }, finish_reason: 'length' }],
    });
    expect((await adapter.chat({ messages: [] })).finishReason).toBe('length');

    h.chatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'x' }, finish_reason: 'content_filter' }],
    });
    expect((await adapter.chat({ messages: [] })).finishReason).toBe('error');

    h.chatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'x' }, finish_reason: 'weird_future_reason' }],
    });
    expect((await adapter.chat({ messages: [] })).finishReason).toBe('stop');
  });

  it('omits tool_choice when tools are set without a toolChoice', async () => {
    const adapter = openaiAdapter({ apiKey: 'sk' });
    await adapter.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
    });
    expect('tool_choice' in h.chatCreate.mock.calls[0][0]).toBe(false);
  });

  it('maps an unrecognized toolChoice object to undefined', async () => {
    const adapter = openaiAdapter({ apiKey: 'sk' });
    await adapter.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
      toolChoice: {} as never,
    });
    expect(h.chatCreate.mock.calls[0][0].tool_choice).toBeUndefined();
  });

  it('throws when the response has no choices', async () => {
    h.chatCreate.mockResolvedValueOnce({ choices: [] });

    const adapter = openaiAdapter({ apiKey: 'sk' });
    await expect(adapter.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      'OpenAI returned empty choices array',
    );
  });
});

// ---------------------------------------------------------------------------
// Message mapping
// ---------------------------------------------------------------------------

describe('openaiAdapter message mapping', () => {
  async function sentMessages(
    messages: Parameters<ReturnType<typeof openaiAdapter>['chat']>[0]['messages'],
  ) {
    const adapter = openaiAdapter({ apiKey: 'sk' });
    await adapter.chat({ messages });
    return h.chatCreate.mock.calls[0][0].messages;
  }

  it('keeps string content and forwards the name field', async () => {
    const msgs = await sentMessages([
      { role: 'user', content: 'plain', name: 'alice' },
      { role: 'assistant', content: 'reply' },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: 'plain', name: 'alice' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('maps text and image parts into content part arrays', async () => {
    const msgs = await sentMessages([
      {
        role: 'user',
        content: [
          'raw string',
          { type: 'text', text: 'typed' },
          { type: 'image', source: 'https://img.example/cat.png' },
        ],
      },
    ]);

    expect(msgs).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'raw string' },
          { type: 'text', text: 'typed' },
          { type: 'image_url', image_url: { url: 'https://img.example/cat.png' } },
        ],
      },
    ]);
  });

  it('maps assistant tool_call parts to tool_calls with stringified arguments', async () => {
    const msgs = await sentMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_call', id: 'c1', name: 'fn', arguments: { a: 1 } }],
      },
    ]);

    expect(msgs).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'fn', arguments: '{"a":1}' } },
        ],
      },
    ]);
  });

  it('flattens tool_result parts into individual tool messages', async () => {
    const msgs = await sentMessages([
      {
        role: 'tool',
        content: [
          { type: 'tool_result', id: 'c1', content: 'result one' },
          { type: 'tool_result', id: 'c2', content: 'result two' },
        ],
      },
    ]);

    expect(msgs).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: 'result one' },
      { role: 'tool', tool_call_id: 'c2', content: 'result two' },
    ]);
  });

  it('maps a single text content object to plain string content', async () => {
    const msgs = await sentMessages([{ role: 'user', content: { type: 'text', text: 'solo' } }]);
    expect(msgs).toEqual([{ role: 'user', content: 'solo' }]);
  });

  it('keeps accompanying text parts when a message mixes text and tool calls', async () => {
    const msgs = await sentMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling now' },
          { type: 'tool_call', id: 'c1', name: 'fn', arguments: {} },
        ],
      },
    ]);

    expect(msgs).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'calling now' }],
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fn', arguments: '{}' } }],
      },
    ]);
  });

  it('ignores unknown array part types', async () => {
    const msgs = await sentMessages([
      { role: 'user', content: [{ type: 'weird' } as never, { type: 'text', text: 'kept' }] },
    ]);
    expect(msgs).toEqual([{ role: 'user', content: [{ type: 'text', text: 'kept' }] }]);
  });

  it('stringifies a single non-text content object as a fallback', async () => {
    const msgs = await sentMessages([{ role: 'user', content: { type: 'image', source: 'x' } }]);
    expect(msgs).toEqual([{ role: 'user', content: '[object Object]' }]);
  });
});

// ---------------------------------------------------------------------------
// stream()
// ---------------------------------------------------------------------------

describe('openaiAdapter.stream', () => {
  it('requests a stream with usage and yields deltas, tool calls, finish and usage', async () => {
    h.chatCreate.mockResolvedValueOnce(
      asyncIter([
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'fn', arguments: '{"a":1}' } },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } },
      ]),
    );

    const adapter = openaiAdapter({ apiKey: 'sk' });
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'q' }] }));

    const body = h.chatCreate.mock.calls[0][0];
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });

    expect(chunks.map((c) => c.delta)).toEqual(['Hel', 'lo', '', '', '']);
    expect(chunks[2].toolCallDelta).toEqual({
      index: 0,
      id: 'c1',
      name: 'fn',
      arguments: { a: 1 },
    });
    expect(chunks[3].finishReason).toBe('stop');
    expect(chunks[4].usage).toEqual({ promptTokens: 5, completionTokens: 6, totalTokens: 11 });
  });

  it('leaves arguments undefined for unparseable partial tool-call fragments', async () => {
    h.chatCreate.mockResolvedValueOnce(
      asyncIter([
        {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"par' } }] } }],
        },
      ]),
    );

    const adapter = openaiAdapter({ apiKey: 'sk' });
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'q' }] }));

    expect(chunks[0].toolCallDelta!.arguments).toBeUndefined();
  });

  it('leaves arguments undefined when a tool-call delta has no arguments yet', async () => {
    h.chatCreate.mockResolvedValueOnce(
      asyncIter([
        {
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'fn' } }] } }],
        },
      ]),
    );

    const adapter = openaiAdapter({ apiKey: 'sk' });
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'q' }] }));
    expect(chunks[0].toolCallDelta).toEqual({
      index: 0,
      id: 'c1',
      name: 'fn',
      arguments: undefined,
    });
  });

  it('omits tool_choice in streams when tools are set without a toolChoice', async () => {
    h.chatCreate.mockResolvedValueOnce(asyncIter([]));
    const adapter = openaiAdapter({ apiKey: 'sk' });
    await collect(
      adapter.stream!({
        messages: [{ role: 'user', content: 'q' }],
        tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
      }),
    );
    expect('tool_choice' in h.chatCreate.mock.calls[0][0]).toBe(false);
  });

  it('maps stream options and tools into the request body', async () => {
    h.chatCreate.mockResolvedValueOnce(asyncIter([]));

    const adapter = openaiAdapter({ apiKey: 'sk' });
    await collect(
      adapter.stream!({
        messages: [{ role: 'user', content: 'q' }],
        temperature: 0.1,
        maxTokens: 2,
        topP: 0.4,
        stop: ['s'],
        tools: [{ name: 'fn', description: 'd', parameters: { type: 'object' } }],
        toolChoice: 'auto',
      }),
    );

    const body = h.chatCreate.mock.calls[0][0];
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(2);
    expect(body.top_p).toBe(0.4);
    expect(body.stop).toEqual(['s']);
    expect(body.tool_choice).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// embeddings()
// ---------------------------------------------------------------------------

describe('openaiAdapter.embeddings', () => {
  it('sends the default model and maps vectors and usage', async () => {
    h.embedCreate.mockResolvedValueOnce({
      data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      usage: { total_tokens: 8 },
    });

    const adapter = openaiAdapter({ apiKey: 'sk' });
    const res = await adapter.embeddings!({ input: ['a', 'b'], extra: { dimensions: 2 } });

    expect(h.embedCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['a', 'b'],
      dimensions: 2,
    });
    expect(res.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(res.usage).toEqual({ totalTokens: 8 });
  });

  it('honours a custom model and omits usage when absent', async () => {
    h.embedCreate.mockResolvedValueOnce({ data: [{ embedding: [1] }] });

    const adapter = openaiAdapter({ apiKey: 'sk' });
    const res = await adapter.embeddings!({ input: 'x', model: 'text-embedding-3-large' });

    expect(h.embedCreate.mock.calls[0][0].model).toBe('text-embedding-3-large');
    expect(res.usage).toBeUndefined();
  });
});
