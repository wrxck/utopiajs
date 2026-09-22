// ============================================================================
// @matthesketh/utopia-ai — Streaming helpers
// ============================================================================

import type { ServerResponse } from 'node:http';

import type { ChatChunk } from '@/types';

/**
 * upper bound on the unflushed sse buffer. a single `data:` line should never
 * approach this; a stream that sends a large amount of data with no newline
 * would otherwise grow the buffer without bound (memory-exhaustion dos).
 */
const MAX_SSE_BUFFER = 1024 * 1024;

/**
 * Stream AI chat chunks as Server-Sent Events (SSE).
 *
 * For a Node `ServerResponse` — an Express or `http.createServer` handler.
 * A UtopiaJS `+server.ts` API route returns a `Response` instead; use
 * `sseResponse` there.
 *
 * ```ts
 * // express
 * app.post('/api/chat', express.json(), async (req, res) => {
 *   await streamSSE(res, ai.stream({ messages: req.body.messages }));
 * });
 * ```
 *
 * Client-side consumption:
 * ```ts
 * const source = new EventSource('/api/chat');
 * // or with fetch:
 * const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages }) });
 * const reader = res.body.getReader();
 * ```
 */
export async function streamSSE(
  res: ServerResponse,
  stream: AsyncIterable<ChatChunk>,
  options?: { onChunk?: (chunk: ChatChunk) => void },
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    for await (const chunk of stream) {
      options?.onChunk?.(chunk);
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write('data: [DONE]\n\n');
  } finally {
    res.end();
  }
}

/**
 * Stream AI chat chunks as a Server-Sent Events `Response` — the form a
 * UtopiaJS `+server.ts` API route returns. `streamSSE` writes to a Node
 * `ServerResponse`, which API routes never receive: they are called with a
 * fetch-style `RequestEvent` and must return a `Response`.
 *
 * ```ts
 * // src/routes/api/chat/+server.ts
 * export async function POST({ request }) {
 *   const { messages } = await request.json();
 *   return sseResponse(ai.stream({ messages }));
 * }
 * ```
 *
 * The body uses the same framing as `streamSSE` (`data: <json>` per chunk,
 * then `data: [DONE]`), so `parseSSEStream` reads either. If the source stream
 * throws, the response body errors rather than ending as if complete.
 */
export function sseResponse(
  stream: AsyncIterable<ChatChunk>,
  options?: { onChunk?: (chunk: ChatChunk) => void; headers?: Record<string, string> },
): Response {
  const encoder = new TextEncoder();
  const iterator = stream[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }
        options?.onChunk?.(value);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      // the client went away — stop the upstream model stream too.
      await iterator.return?.();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      ...options?.headers,
    },
  });
}

/**
 * Collect an async iterable of ChatChunks into a full text string.
 *
 * ```ts
 * const text = await collectStream(ai.stream({ messages }));
 * ```
 */
export async function collectStream(stream: AsyncIterable<ChatChunk>): Promise<string> {
  let result = '';
  for await (const chunk of stream) {
    result += chunk.delta;
  }
  return result;
}

/**
 * Parse SSE events from a fetch Response body (browser-side).
 *
 * ```ts
 * const res = await fetch('/api/chat', { method: 'POST', body: '...' });
 * for await (const chunk of parseSSEStream(res)) {
 *   console.log(chunk.delta);
 * }
 * ```
 */
export async function* parseSSEStream(response: Response): AsyncIterable<ChatChunk> {
  if (!response.body) {
    throw new Error('Response body is null — streaming not supported');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_SSE_BUFFER) {
        throw new Error('SSE stream exceeded maximum buffer size without a line delimiter');
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as ChatChunk;
          } catch {
            console.warn('[utopia-ai] Skipping malformed SSE data:', data);
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
