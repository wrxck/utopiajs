// regression tests for the v0.8.1 ai hardening pass: stream buffer caps and
// adapter base-url scheme validation.

import { describe, it, expect } from 'vitest';

import { parseSSEStream } from './streaming';
import { ollamaAdapter } from './adapters/ollama';

function streamResponse(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream);
}

describe('parseSSEStream bounds its buffer', () => {
  it('throws instead of buffering a huge chunk with no line delimiter', async () => {
    const huge = new TextEncoder().encode('x'.repeat(2_000_000));
    const res = streamResponse([huge]);
    await expect(
      (async () => {
        for await (const _chunk of parseSSEStream(res)) {
          void _chunk;
        }
      })(),
    ).rejects.toThrow(/buffer/i);
  });

  it('still parses normal newline-delimited events', async () => {
    const body = new TextEncoder().encode('data: {"delta":"hi"}\n\ndata: [DONE]\n\n');
    const chunks: string[] = [];
    for await (const c of parseSSEStream(streamResponse([body]))) {
      chunks.push(c.delta);
    }
    expect(chunks).toEqual(['hi']);
  });
});

describe('ollama adapter validates the base url', () => {
  it('rejects a non-http(s) base url', () => {
    expect(() => ollamaAdapter({ baseURL: 'file:///etc/passwd' })).toThrow(/http/i);
  });

  it('accepts a valid http base url', () => {
    expect(() => ollamaAdapter({ baseURL: 'http://localhost:11434' })).not.toThrow();
  });
});
