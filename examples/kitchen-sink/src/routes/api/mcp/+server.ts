// API route: POST /api/mcp
// Demonstrates @matthesketh/utopia-ai MCP server with tools, resources, and prompts

import { createMCPServer, createMCPHandler } from '@matthesketh/utopia-ai/mcp'
import type { IncomingMessage, ServerResponse } from 'node:http'

const mcp = createMCPServer({
  name: 'kitchen-sink-mcp',
  version: '0.0.1',

  tools: [
    {
      definition: {
        name: 'get_weather',
        description: 'Get the current weather for a city',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
            units: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Temperature units' },
          },
          required: ['city'],
        },
      },
      handler: async (args) => {
        const city = args.city as string
        const units = (args.units as string) ?? 'celsius'
        const temp = units === 'celsius' ? 22 : 72
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ city, temperature: temp, units, condition: 'Sunny' }),
          }],
        }
      },
    },
    {
      definition: {
        name: 'search_docs',
        description: 'Search UtopiaJS documentation',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
      handler: async (args) => {
        const query = args.query as string
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              results: [
                { title: 'Signals — signal(), computed(), effect()', url: '/docs/architecture' },
                { title: 'SSR — renderToString, hydrate', url: '/docs/ssr' },
                { title: 'AI — createAI, adapters, MCP', url: '/docs/ai' },
              ].filter(r => r.title.toLowerCase().includes(query.toLowerCase())),
            }),
          }],
        }
      },
    },
  ],

  resources: [
    {
      definition: {
        uri: 'config://app',
        name: 'App Configuration',
        description: 'Current application configuration',
        mimeType: 'application/json',
      },
      handler: async () => ({
        uri: 'config://app',
        mimeType: 'application/json',
        text: JSON.stringify({
          name: 'kitchen-sink',
          version: '0.0.1',
          features: ['signals', 'router', 'ssr', 'email', 'ai', 'mcp'],
        }),
      }),
    },
  ],

  prompts: [
    {
      definition: {
        name: 'explain_feature',
        description: 'Explain a UtopiaJS feature',
        arguments: [
          { name: 'feature', description: 'Feature name', required: true },
        ],
      },
      handler: async (args) => ({
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Explain the UtopiaJS "${args.feature}" feature in detail. Include code examples.`,
            },
          },
        ],
      }),
    },
  ],
})

const handler = createMCPHandler(mcp)

export async function POST(req: IncomingMessage, res: ServerResponse) {
  handler(req, res)
}

export async function GET(req: IncomingMessage, res: ServerResponse) {
  // SSE transport for MCP
  handler(req, res)
}
