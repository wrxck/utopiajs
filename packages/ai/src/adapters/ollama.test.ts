// ============================================================================
// @matthesketh/utopia-ai — Ollama adapter tests (mocked fetch, no network)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ollamaAdapter } from './ollama';
import type { ChatChunk, ChatRequest } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchMock(): ReturnType<typeof vi.fn> {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function errorResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

/**
 * Build a streaming Response whose body emits the given string chunks.
 * Returns the response plus a spy on the reader's cancel().
 */
function streamingResponse(chunks: string[]): {
  response: Response;
  cancel: ReturnType<typeof vi.fn>;
} {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });

  const realReader = stream.getReader();
  const cancel = vi.fn(() => Promise.resolve());
  const response = {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: realReader.read.bind(realReader),
          cancel,
          releaseLock: realReader.releaseLock.bind(realReader),
        };
      },
    },
  } as unknown as Response;

  return { response, cancel };
}

async function collect(iterable: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// chat()
// ---------------------------------------------------------------------------

describe('ollamaAdapter.chat', () => {
  it('POSTs to /api/chat with defaults and maps the response', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({
        message: { role: 'assistant', content: 'hi there' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 7,
        eval_count: 3,
      }),
    );

    const adapter = ollamaAdapter();
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(fetchMock()).toHaveBeenCalledOnce();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
      options: {},
    });

    expect(res.content).toBe('hi there');
    expect(res.finishReason).toBe('stop');
    expect(res.toolCalls).toBeUndefined();
    expect(res.usage).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
    expect(res.raw).toBeDefined();
  });

  it('maps sampling params, stop sequences and model overrides into the body', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ message: { content: '' }, done: true }));

    const adapter = ollamaAdapter({ baseURL: 'http://gpu-box:11434/', defaultModel: 'mistral' });
    await adapter.chat({
      messages: [{ role: 'user', content: 'x' }],
      model: 'qwen2',
      temperature: 0.4,
      topP: 0.9,
      maxTokens: 128,
      stop: ['END'],
    });

    const [url, init] = fetchMock().mock.calls[0];
    // trailing slash trimmed
    expect(url).toBe('http://gpu-box:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen2');
    expect(body.options).toEqual({ temperature: 0.4, top_p: 0.9, num_predict: 128, stop: ['END'] });
  });

  it('falls back to the config defaultModel when the request has none', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ message: { content: '' }, done: true }));

    const adapter = ollamaAdapter({ defaultModel: 'mistral' });
    await adapter.chat({ messages: [{ role: 'user', content: 'x' }] });

    expect(JSON.parse(fetchMock().mock.calls[0][1].body).model).toBe('mistral');
  });

  it('maps tool definitions into the request body', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ message: { content: '' }, done: true }));

    const adapter = ollamaAdapter();
    await adapter.chat({
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });

    const body = JSON.parse(fetchMock().mock.calls[0][1].body);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ]);
  });

  it('maps tool calls in the response with unique ids', async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({
        message: {
          content: '',
          tool_calls: [
            { function: { name: 'get_weather', arguments: { city: 'NYC' } } },
            { function: { name: 'get_time', arguments: undefined } },
          ],
        },
        done: true,
      }),
    );

    const adapter = ollamaAdapter();
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'x' }] });

    expect(res.toolCalls).toHaveLength(2);
    expect(res.toolCalls![0].name).toBe('get_weather');
    expect(res.toolCalls![0].arguments).toEqual({ city: 'NYC' });
    expect(res.toolCalls![1].arguments).toEqual({});
    expect(res.toolCalls![0].id).not.toBe(res.toolCalls![1].id);

    const res2 = await adapter.chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(res2.toolCalls![0].id).not.toBe(res.toolCalls![0].id);
  });

  it('maps done_reason "length" to finishReason "length"', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ message: { content: 'cut off' }, done: true, done_reason: 'length' }),
    );

    const adapter = ollamaAdapter();
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(res.finishReason).toBe('length');
  });

  it('throws a descriptive error on non-ok responses', async () => {
    fetchMock().mockResolvedValueOnce(errorResponse(500, '{"error":"model not found"}'));

    const adapter = ollamaAdapter();
    await expect(adapter.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      'Ollama error 500: {"error":"model not found"}',
    );
  });

  it('handles a response with no message', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ done: true }));

    const adapter = ollamaAdapter();
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(res.content).toBe('');
    expect(res.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});

// ---------------------------------------------------------------------------
// Message mapping
// ---------------------------------------------------------------------------

describe('ollamaAdapter message mapping', () => {
  async function sentMessages(messages: ChatRequest['messages']) {
    fetchMock().mockResolvedValueOnce(jsonResponse({ message: { content: '' }, done: true }));
    const adapter = ollamaAdapter();
    await adapter.chat({ messages });
    return JSON.parse(fetchMock().mock.calls[0][1].body).messages;
  }

  it('joins text parts and collects images', async () => {
    const msgs = await sentMessages([
      {
        role: 'user',
        content: [
          'plain string part',
          { type: 'text', text: 'typed text part' },
          { type: 'image', source: 'BASE64DATA', mediaType: 'image/png' },
        ],
      },
    ]);

    expect(msgs).toEqual([
      {
        role: 'user',
        content: 'plain string part\ntyped text part',
        images: ['BASE64DATA'],
      },
    ]);
  });

  it('maps tool role to user and inlines tool_result content', async () => {
    const msgs = await sentMessages([
      {
        role: 'tool',
        content: [{ type: 'tool_result', id: 'call_1', content: '{"temp":72}' }],
      },
    ]);

    expect(msgs).toEqual([{ role: 'user', content: '{"temp":72}' }]);
  });

  it('preserves assistant tool calls so multi-round tool loops keep history', async () => {
    const msgs = await sentMessages([
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', id: 'call_1', name: 'get_weather', arguments: { city: 'NYC' } },
        ],
      },
    ]);

    expect(msgs).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'NYC' } } }],
      },
    ]);
  });

  it('maps a single text content object', async () => {
    const msgs = await sentMessages([{ role: 'user', content: { type: 'text', text: 'solo' } }]);
    expect(msgs).toEqual([{ role: 'user', content: 'solo' }]);
  });

  it('maps a single non-text content object to empty content', async () => {
    const msgs = await sentMessages([{ role: 'user', content: { type: 'image', source: 'xyz' } }]);
    expect(msgs).toEqual([{ role: 'user', content: '' }]);
  });

  it('ignores unknown array part types', async () => {
    const msgs = await sentMessages([
      { role: 'user', content: [{ type: 'weird' } as never, { type: 'text', text: 'kept' }] },
    ]);
    expect(msgs).toEqual([{ role: 'user', content: 'kept' }]);
  });
});

// ---------------------------------------------------------------------------
// stream()
// ---------------------------------------------------------------------------

describe('ollamaAdapter.stream', () => {
  it('parses NDJSON lines even when a line is split across chunk boundaries', async () => {
    const line1 = JSON.stringify({ message: { content: 'Hel' }, done: false });
    const line2 = JSON.stringify({ message: { content: 'lo' }, done: false });
    const done = JSON.stringify({
      message: { content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 5,
      eval_count: 2,
    });

    // Split mid-JSON: the boundary falls inside line2
    const { response } = streamingResponse([
      line1 + '\n' + line2.slice(0, 8),
      line2.slice(8) + '\n',
      done + '\n',
    ]);
    fetchMock().mockResolvedValueOnce(response);

    const adapter = ollamaAdapter();
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'x' }] }));

    expect(chunks.map((c) => c.delta)).toEqual(['Hel', 'lo', '']);
    expect(chunks[2].finishReason).toBe('stop');
    expect(chunks[2].usage).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  });

  it('sends stream: true and the mapped options in the request body', async () => {
    const { response } = streamingResponse([JSON.stringify({ done: true }) + '\n']);
    fetchMock().mockResolvedValueOnce(response);

    const adapter = ollamaAdapter();
    await collect(
      adapter.stream!({
        messages: [{ role: 'user', content: 'x' }],
        temperature: 0.1,
        topP: 0.5,
        maxTokens: 10,
        stop: ['a'],
        tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
      }),
    );

    const body = JSON.parse(fetchMock().mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.options).toEqual({ temperature: 0.1, top_p: 0.5, num_predict: 10, stop: ['a'] });
    expect(body.tools).toHaveLength(1);
  });

  it('skips blank and malformed NDJSON lines', async () => {
    const { response } = streamingResponse([
      '\n',
      '{broken json\n',
      JSON.stringify({ message: { content: 'ok' }, done: false }) + '\n',
      JSON.stringify({ done: true }) + '\n',
    ]);
    fetchMock().mockResolvedValueOnce(response);

    const adapter = ollamaAdapter();
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'x' }] }));

    expect(chunks.map((c) => c.delta)).toEqual(['ok', '']);
  });

  it('maps done_reason "length" to finishReason "length" on the final chunk', async () => {
    const { response } = streamingResponse([
      JSON.stringify({ message: { content: 'partial' }, done: false }) + '\n',
      JSON.stringify({ message: { content: '' }, done: true, done_reason: 'length' }) + '\n',
    ]);
    fetchMock().mockResolvedValueOnce(response);

    const adapter = ollamaAdapter();
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'x' }] }));

    expect(chunks[chunks.length - 1].finishReason).toBe('length');
  });

  it('throws a descriptive error on non-ok responses', async () => {
    fetchMock().mockResolvedValueOnce(errorResponse(404, 'no such model'));

    const adapter = ollamaAdapter();
    await expect(
      collect(adapter.stream!({ messages: [{ role: 'user', content: 'x' }] })),
    ).rejects.toThrow('Ollama error 404: no such model');
  });

  it('throws when the response has no body', async () => {
    fetchMock().mockResolvedValueOnce({ ok: true, status: 200, body: null } as unknown as Response);

    const adapter = ollamaAdapter();
    await expect(
      collect(adapter.stream!({ messages: [{ role: 'user', content: 'x' }] })),
    ).rejects.toThrow('streaming not supported');
  });

  it('releases the reader when the consumer stops iterating early', async () => {
    const { response, cancel } = streamingResponse([
      JSON.stringify({ message: { content: 'first' }, done: false }) + '\n',
      JSON.stringify({ message: { content: 'second' }, done: false }) + '\n',
      JSON.stringify({ done: true }) + '\n',
    ]);
    fetchMock().mockResolvedValueOnce(response);

    const adapter = ollamaAdapter();
    for await (const chunk of adapter.stream!({ messages: [{ role: 'user', content: 'x' }] })) {
      expect(chunk.delta).toBe('first');
      break; // abandon the stream after the first chunk
    }

    expect(cancel).toHaveBeenCalled();
  });

  it('swallows reader.cancel rejections during cleanup', async () => {
    const { response, cancel } = streamingResponse([JSON.stringify({ done: true }) + '\n']);
    cancel.mockRejectedValue(new Error('already closed'));
    fetchMock().mockResolvedValueOnce(response);

    const adapter = ollamaAdapter();
    const chunks = await collect(adapter.stream!({ messages: [{ role: 'user', content: 'x' }] }));
    expect(chunks).toHaveLength(1);
    expect(cancel).toHaveBeenCalled();
  });

  it('releases the reader when the buffer cap is exceeded', async () => {
    const { response, cancel } = streamingResponse(['x'.repeat(2_000_000)]);
    fetchMock().mockResolvedValueOnce(response);

    const adapter = ollamaAdapter();
    await expect(
      collect(adapter.stream!({ messages: [{ role: 'user', content: 'x' }] })),
    ).rejects.toThrow(/buffer/i);

    expect(cancel).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// embeddings()
// ---------------------------------------------------------------------------

describe('ollamaAdapter.embeddings', () => {
  it('POSTs each input to /api/embed and flattens the results', async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.1, 0.2]] }))
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[0.3, 0.4]] }));

    const adapter = ollamaAdapter();
    const res = await adapter.embeddings!({ input: ['a', 'b'] });

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(fetchMock().mock.calls[0][0]).toBe('http://localhost:11434/api/embed');
    expect(JSON.parse(fetchMock().mock.calls[0][1].body)).toEqual({
      model: 'nomic-embed-text',
      input: 'a',
    });
    expect(res.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it('accepts a single string input and a custom model', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ embeddings: [[1, 2, 3]] }));

    const adapter = ollamaAdapter();
    const res = await adapter.embeddings!({ input: 'solo', model: 'my-embedder' });

    expect(JSON.parse(fetchMock().mock.calls[0][1].body).model).toBe('my-embedder');
    expect(res.embeddings).toEqual([[1, 2, 3]]);
  });

  it('supports the legacy single-embedding response shape', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ embedding: [9, 8] }));

    const adapter = ollamaAdapter();
    const res = await adapter.embeddings!({ input: 'legacy' });
    expect(res.embeddings).toEqual([[9, 8]]);
  });

  it('returns no vectors for a malformed response instead of [undefined]', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({}));

    const adapter = ollamaAdapter();
    const res = await adapter.embeddings!({ input: 'weird' });
    expect(res.embeddings).toEqual([]);
  });

  it('throws a descriptive error on non-ok responses', async () => {
    fetchMock().mockResolvedValueOnce(errorResponse(503, 'overloaded'));

    const adapter = ollamaAdapter();
    await expect(adapter.embeddings!({ input: 'x' })).rejects.toThrow(
      'Ollama error 503: overloaded',
    );
  });
});

// ---------------------------------------------------------------------------
// Base URL validation
// ---------------------------------------------------------------------------

describe('ollamaAdapter base URL', () => {
  it('rejects non-http(s) protocols', () => {
    expect(() => ollamaAdapter({ baseURL: 'ftp://host' })).toThrow(/http/i);
  });

  it('accepts https', () => {
    expect(() => ollamaAdapter({ baseURL: 'https://remote:11434' })).not.toThrow();
  });
});
