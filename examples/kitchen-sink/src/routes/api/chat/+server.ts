// API route: POST /api/chat
// Demonstrates @utopia/ai with OpenAI adapter + SSE streaming

import { createAI } from '@utopia/ai'
import { openaiAdapter } from '@utopia/ai/openai'
import { streamSSE } from '@utopia/ai'
import type { IncomingMessage, ServerResponse } from 'node:http'

const ai = createAI(
  openaiAdapter({
    apiKey: process.env.OPENAI_API_KEY!,
    defaultModel: 'gpt-4o',
  }),
  {
    hooks: {
      onBeforeChat(request) {
        console.log(`[ai] chat request: ${request.messages.length} messages`)
        return request
      },
      onError(error, context) {
        console.error(`[ai] error in ${context.method}:`, error.message)
      },
    },
    retry: {
      maxRetries: 2,
      baseDelay: 1000,
    },
  },
)

export async function POST(req: IncomingMessage, res: ServerResponse) {
  const body = await new Promise<string>((resolve) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk.toString() })
    req.on('end', () => resolve(data))
  })

  const { messages } = JSON.parse(body)

  // Stream AI response as SSE
  const stream = ai.stream({
    messages,
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 1024,
  })

  await streamSSE(res, stream, {
    onChunk(chunk) {
      if (chunk.finishReason) {
        console.log(`[ai] stream finished: ${chunk.finishReason}`)
      }
    },
  })
}
