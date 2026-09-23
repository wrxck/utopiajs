// ============================================================================
// @matthesketh/utopia-ai — Streaming helper edge cases
// ============================================================================

import type { ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { parseSSEStream, sseResponse, streamSSE } from './streaming';
import type { ChatChunk } from './types';

describe('parseSSEStream edge cases', () => {
  it('throws when the response has no body', async () => {
    const response = { body: null } as unknown as Response;
    await expect(
      (async () => {
        for await (const chunk of parseSSEStream(response)) void chunk;
      })(),
    ).rejects.toThrow('streaming not supported');
  });

  it('parses events split across chunk boundaries, including multi-byte characters', async () => {
    const event = 'data: {"delta":"héllo → wörld"}\n\n';
    const bytes = new TextEncoder().encode(event);
    // Split inside the multi-byte "é" (0xC3 0xA9) at byte offset 12
    const chunks = [bytes.slice(0, 12), bytes.slice(12, 20), bytes.slice(20)];

    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
    });

    const out: ChatChunk[] = [];
    for await (const chunk of parseSSEStream(new Response(stream))) {
      out.push(chunk);
    }

    expect(out).toEqual([{ delta: 'héllo → wörld' }]);
  });

  it('handles CRLF line endings', async () => {
    const body = new TextEncoder().encode(
      'data: {"delta":"one"}\r\n\r\ndata: {"delta":"two"}\r\n\r\ndata: [DONE]\r\n\r\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });

    const out: ChatChunk[] = [];
    for await (const chunk of parseSSEStream(new Response(stream))) {
      out.push(chunk);
    }
    expect(out.map((c) => c.delta)).toEqual(['one', 'two']);
  });
});

describe('parseSSEStream cleanup', () => {
  it('swallows reader.cancel rejections during cleanup', async () => {
    const body = new TextEncoder().encode('data: {"delta":"hi"}\n\ndata: [DONE]\n\n');
    let sent = false;
    const response = {
      body: {
        getReader() {
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: body };
            },
            cancel: () => Promise.reject(new Error('cancel failed')),
            releaseLock: () => {},
          };
        },
      },
    } as unknown as Response;

    const out: ChatChunk[] = [];
    for await (const chunk of parseSSEStream(response)) {
      out.push(chunk);
    }
    expect(out).toEqual([{ delta: 'hi' }]);
  });
});

describe('streamSSE error handling', () => {
  it('still ends the response when the source stream throws', async () => {
    const res = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse & { end: ReturnType<typeof vi.fn> };

    async function* failing(): AsyncIterable<ChatChunk> {
      yield { delta: 'partial' };
      throw new Error('upstream exploded');
    }

    await expect(streamSSE(res, failing())).rejects.toThrow('upstream exploded');
    expect(res.end).toHaveBeenCalled();
  });
});

describe('sseResponse', () => {
  async function* chunks(): AsyncGenerator<ChatChunk> {
    yield { delta: 'Hel' } as ChatChunk;
    yield { delta: 'lo' } as ChatChunk;
  }

  it('returns an event-stream Response that parseSSEStream reads back', async () => {
    const response = sseResponse(chunks());
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const text: string[] = [];
    for await (const chunk of parseSSEStream(response)) text.push(chunk.delta);
    expect(text.join('')).toBe('Hello');
  });

  it('errors the body when the source stream throws, rather than ending cleanly', async () => {
    async function* failing(): AsyncGenerator<ChatChunk> {
      yield { delta: 'partial' } as ChatChunk;
      throw new Error('upstream failed');
    }
    const response = sseResponse(failing());
    await expect(response.text()).rejects.toThrow();
  });

  it('stops the source stream when the client cancels', async () => {
    let finished = false;
    async function* endless(): AsyncGenerator<ChatChunk> {
      try {
        for (;;) yield { delta: 'x' } as ChatChunk;
      } finally {
        finished = true;
      }
    }
    const reader = sseResponse(endless()).body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(finished).toBe(true);
  });
});
