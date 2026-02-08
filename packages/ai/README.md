# @utopia/ai

AI adapters and MCP support for UtopiaJS. Unified interface for chat completions, streaming, embeddings, and agentic tool loops. Built-in support for OpenAI, Anthropic, Google Gemini, and Ollama. Includes a full MCP (Model Context Protocol) server and client implementation.

## Install

```bash
pnpm add @utopia/ai
```

Install a provider SDK as needed:

```bash
pnpm add openai              # for OpenAI
pnpm add @anthropic-ai/sdk   # for Anthropic
pnpm add @google/generative-ai  # for Google Gemini
# Ollama requires no extra dependency
```

## Usage

```ts
import { createAI } from '@utopia/ai';
import { openaiAdapter } from '@utopia/ai/openai';

const ai = createAI(openaiAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
}));

// Chat
const res = await ai.chat({
  messages: [{ role: 'user', content: 'Hello!' }],
});

// Streaming
for await (const chunk of ai.stream({ messages })) {
  process.stdout.write(chunk.delta);
}

// Agentic tool loop
const result = await ai.run({
  messages: [{ role: 'user', content: 'What is the weather?' }],
  tools: [{
    definition: { name: 'get_weather', description: '...', parameters: { type: 'object', properties: {} } },
    handler: async ({ city }) => ({ temp: 72 }),
  }],
});
```

## API

| Export | Description |
|--------|-------------|
| `createAI(adapter, options?)` | Create an AI instance with hooks and retry |
| `streamSSE(res, stream)` | Stream chat chunks as Server-Sent Events |
| `parseSSEStream(response)` | Parse SSE events from a fetch Response (browser) |
| `collectStream(stream)` | Collect a stream into a single string |

**Adapters:** `@utopia/ai/openai`, `@utopia/ai/anthropic`, `@utopia/ai/google`, `@utopia/ai/ollama`.

**MCP (`@utopia/ai/mcp`):** `createMCPServer`, `createMCPClient`, `createMCPHandler`.

See [docs/ai.md](../../docs/ai.md) for full documentation on adapters, streaming, tool calling, MCP, and type reference.

## License

MIT
