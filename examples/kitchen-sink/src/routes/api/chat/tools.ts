// Demonstrates @utopia/ai tool-calling loop + MCP client bridge
// This file can be imported into the chat API route for agentic capabilities

import { createAI } from '@utopia/ai'
import { openaiAdapter } from '@utopia/ai/openai'
import { createMCPClient } from '@utopia/ai/mcp'
import type { ToolHandler } from '@utopia/ai'

const ai = createAI(
  openaiAdapter({
    apiKey: process.env.OPENAI_API_KEY!,
    defaultModel: 'gpt-4o',
  }),
)

// Local tool handlers
const localTools: ToolHandler[] = [
  {
    definition: {
      name: 'calculate',
      description: 'Evaluate a math expression',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression (e.g. "2 + 2")' },
        },
        required: ['expression'],
      },
    },
    handler: async (args) => {
      const expr = args.expression as string
      // Simple safe eval for basic math
      const result = Function(`"use strict"; return (${expr.replace(/[^0-9+\-*/().%\s]/g, '')})`)()
      return { expression: expr, result }
    },
  },
  {
    definition: {
      name: 'get_time',
      description: 'Get the current date and time',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    handler: async () => ({
      iso: new Date().toISOString(),
      unix: Date.now(),
    }),
  },
]

/**
 * Run an agentic tool-calling loop with both local tools
 * and MCP server tools bridged together.
 */
export async function runAgenticChat(userMessage: string) {
  // Bridge MCP tools from the local MCP server
  let mcpTools: ToolHandler[] = []
  try {
    const mcpClient = createMCPClient({
      url: 'http://localhost:3000/api/mcp',
    })
    await mcpClient.initialize()
    mcpTools = await mcpClient.toToolHandlers()
  } catch {
    console.log('[tools] MCP server not available, using local tools only')
  }

  // Combine local + MCP tools
  const allTools = [...localTools, ...mcpTools]

  // Run the agentic loop
  const response = await ai.run({
    messages: [
      { role: 'system', content: 'You are a helpful assistant with access to tools. Use them when appropriate.' },
      { role: 'user', content: userMessage },
    ],
    tools: allTools,
    maxRounds: 5,
    onToolCall(call, result) {
      console.log(`[tools] ${call.name}(${JSON.stringify(call.arguments)}) => ${JSON.stringify(result)}`)
    },
  })

  return response
}
