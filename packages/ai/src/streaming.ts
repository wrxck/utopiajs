// ============================================================================
// @matthesketh/utopia-ai — Streaming helpers
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChatChunk } from './types.js';

/**
 * Stream AI chat chunks as Server-Sent Events (SSE).
 *
 * Compatible with the UtopiaJS server handler pattern. Use this in
 * API routes to stream AI responses to the browser.
 *
 * ```ts
 * // +server.ts (API route)
 * import { createAI } from '@matthesketh/utopia-ai';
 * import { openaiAdapter } from '@matthesketh/utopia-ai/openai';
 * import { streamSSE } from '@matthesketh/utopia-ai';
 *
 * const ai = createAI(openaiAdapter({ apiKey: process.env.OPENAI_API_KEY }));
 *
 * export async function POST(req, res) {
 *   const { messages } = await parseBody(req);
 *   const stream = ai.stream({ messages });
 *   await streamSSE(res, stream);
 * }
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
    'Connection': 'keep-alive',
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
export async function* parseSSEStream(
  response: Response,
): AsyncIterable<ChatChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as ChatChunk;
          } catch {
            // Skip malformed SSE data
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
