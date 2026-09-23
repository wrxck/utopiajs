// API route: POST /api/chat
// Demonstrates @matthesketh/utopia-ai with OpenAI adapter + SSE streaming.
// API routes receive a fetch-style RequestEvent and return a Response.

import { createAI, sseResponse } from '@matthesketh/utopia-ai';
import { openaiAdapter } from '@matthesketh/utopia-ai/openai';
import type { RequestEvent } from '@matthesketh/utopia-server';

const ai = createAI(
  openaiAdapter({
    apiKey: process.env.OPENAI_API_KEY!,
    defaultModel: 'gpt-4o',
  }),
  {
    hooks: {
      onBeforeChat(request) {
        console.log(`[ai] chat request: ${request.messages.length} messages`);
        return request;
      },
      onError(error, context) {
        console.error(`[ai] error in ${context.method}:`, error.message);
      },
    },
    retry: {
      maxRetries: 2,
      baseDelay: 1000,
    },
  },
);

export async function POST({ request }: RequestEvent) {
  const { messages } = await request.json();

  // Stream AI response as SSE
  const stream = ai.stream({
    messages,
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 1024,
  });

  return sseResponse(stream, {
    onChunk(chunk) {
      if (chunk.finishReason) {
        console.log(`[ai] stream finished: ${chunk.finishReason}`);
      }
    },
  });
}
