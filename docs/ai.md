# AI & MCP Support

`@utopia/ai` provides adapter-based AI integration for UtopiaJS applications. Same factory pattern as email: `createAI(adapter)` returns a unified interface for chat completions, streaming, embeddings, and agentic tool loops. Supports OpenAI, Anthropic, Google Gemini, and Ollama out of the box.

The package also includes a full MCP (Model Context Protocol) implementation -- server, client, and HTTP handler -- for tool interop between AI agents and external services.

## Quick Start

```bash
pnpm add @utopia/ai openai
```

```ts
import { createAI } from '@utopia/ai';
import { openaiAdapter } from '@utopia/ai/openai';

const ai = createAI(openaiAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
}));

const response = await ai.chat({
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.content);
```

## Adapters

Each adapter is imported from a separate entry point so unused providers are never bundled.

| Provider | Import Path | Config Type | Default Model | Features |
|----------|-------------|-------------|---------------|----------|
| OpenAI | `@utopia/ai/openai` | `OpenAIConfig` | `gpt-4o` | chat, stream, embeddings |
| Anthropic | `@utopia/ai/anthropic` | `AnthropicConfig` | `claude-sonnet-4-5-20250929` | chat, stream |
| Google Gemini | `@utopia/ai/google` | `GoogleConfig` | `gemini-2.0-flash` | chat, stream, embeddings |
| Ollama | `@utopia/ai/ollama` | `OllamaConfig` | `llama3.2` | chat, stream, embeddings |

All adapters lazy-load their provider SDK on first use. The Ollama adapter requires no external SDK -- it uses native `fetch` against the local Ollama API.

### Config Types

```ts
interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
  organization?: string;
  defaultModel?: string;
}

interface AnthropicConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

interface GoogleConfig {
  apiKey: string;
  defaultModel?: string;
}

interface OllamaConfig {
  baseURL?: string;       // default: 'http://localhost:11434'
  defaultModel?: string;
}
```

### Adapter Example

```ts
import { createAI } from '@utopia/ai';
import { anthropicAdapter } from '@utopia/ai/anthropic';

const ai = createAI(anthropicAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY!,
}));
```

## Chat API

### `ai.chat(request)`

Send a chat completion request. Returns a `Promise<ChatResponse>`.

**ChatRequest:**

| Field | Type | Description |
|-------|------|-------------|
| `messages` | `ChatMessage[]` | Conversation history (required) |
| `model` | `string` | Override the adapter's default model |
| `temperature` | `number` | Sampling temperature |
| `maxTokens` | `number` | Maximum tokens to generate |
| `topP` | `number` | Nucleus sampling parameter |
| `stop` | `string[]` | Stop sequences |
| `tools` | `ToolDefinition[]` | Available tools for function calling |
| `toolChoice` | `'auto' \| 'none' \| 'required' \| { name: string }` | Tool selection mode |
| `extra` | `Record<string, unknown>` | Adapter-specific options passed through untouched |

**ChatResponse:**

| Field | Type | Description |
|-------|------|-------------|
| `content` | `string` | The generated text |
| `toolCalls` | `ToolCall[]` | Tool calls requested by the model (if any) |
| `finishReason` | `'stop' \| 'tool_calls' \| 'length' \| 'error'` | Why generation stopped |
| `usage` | `TokenUsage` | Token counts (prompt, completion, total) |
| `raw` | `unknown` | Raw provider response for advanced use cases |

**ChatMessage:**

| Field | Type | Description |
|-------|------|-------------|
| `role` | `'system' \| 'user' \| 'assistant' \| 'tool'` | Message role |
| `content` | `string \| MessageContent \| MessageContent[]` | Text, images, tool calls, or tool results |
| `name` | `string` | Optional sender name |

Content types include `TextContent`, `ImageContent`, `ToolCallContent`, and `ToolResultContent`.

## Streaming

### `ai.stream(request)`

Returns an `AsyncIterable<ChatChunk>` for incremental consumption.

```ts
for await (const chunk of ai.stream({ messages })) {
  process.stdout.write(chunk.delta);
}
```

**ChatChunk:**

| Field | Type | Description |
|-------|------|-------------|
| `delta` | `string` | Incremental text delta |
| `toolCallDelta` | `Partial<ToolCall> & { index?: number }` | Incremental tool call data |
| `finishReason` | `ChatResponse['finishReason']` | Set on the final chunk |
| `usage` | `TokenUsage` | Set on the final chunk |

If the adapter does not implement `stream()`, the AI instance falls back to a single-chunk wrapper around `chat()`.

### `streamSSE(res, stream, options?)`

Stream `ChatChunk`s as Server-Sent Events over an HTTP response. Use this in API routes to stream AI responses to the browser.

```ts
// Server — API route
import { createAI, streamSSE } from '@utopia/ai';
import { openaiAdapter } from '@utopia/ai/openai';

const ai = createAI(openaiAdapter({ apiKey: process.env.OPENAI_API_KEY! }));

export async function POST(req: any, res: any) {
  const { messages } = JSON.parse(await readBody(req));
  const stream = ai.stream({ messages });
  await streamSSE(res, stream);
}
```

Sets `Content-Type: text/event-stream` and writes `data: <JSON>\n\n` for each chunk, ending with `data: [DONE]\n\n`.

### `parseSSEStream(response)`

Browser-side parser. Takes a `fetch` `Response` and yields `ChatChunk` objects.

```ts
// Browser
const res = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ messages }),
});

for await (const chunk of parseSSEStream(res)) {
  output.textContent += chunk.delta;
}
```

### `collectStream(stream)`

Collect an `AsyncIterable<ChatChunk>` into a single string.

```ts
const text = await collectStream(ai.stream({ messages }));
```

## Tool Calling

### `ai.run(options)`

Run an agentic tool-calling loop. Sends messages to the model, executes any tool calls via the provided handlers, appends results, and repeats until the model stops calling tools or the round limit is reached.

**RunOptions:**

| Field | Type | Description |
|-------|------|-------------|
| `messages` | `ChatMessage[]` | Initial conversation (required) |
| `tools` | `ToolHandler[]` | Tool definitions + handler functions (required) |
| `model` | `string` | Override default model |
| `temperature` | `number` | Sampling temperature |
| `maxTokens` | `number` | Max tokens per round |
| `maxRounds` | `number` | Maximum tool-calling rounds (default: 10) |
| `onToolCall` | `(call: ToolCall, result: unknown) => void` | Callback after each tool execution |
| `extra` | `Record<string, unknown>` | Adapter-specific options |

**ToolHandler:**

```ts
interface ToolHandler {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}
```

**Example:**

```ts
const response = await ai.run({
  messages: [{ role: 'user', content: 'What is the weather in NYC?' }],
  tools: [{
    definition: {
      name: 'get_weather',
      description: 'Get the current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    },
    handler: async ({ city }) => {
      // Call your weather API
      return { temperature: 72, condition: 'sunny' };
    },
  }],
  onToolCall: (call, result) => {
    console.log(`Tool ${call.name} returned:`, result);
  },
});

console.log(response.content); // "The weather in NYC is 72F and sunny."
```

When `maxRounds` is reached, a final request is made with `toolChoice: 'none'` to force a text response.

## MCP Server

### `createMCPServer(config)`

Create an MCP server that exposes tools, resources, and prompts via the JSON-RPC 2.0-based Model Context Protocol (version `2024-11-05`).

**MCPServerConfig:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Server name (required) |
| `version` | `string` | Server version (default: `'1.0.0'`) |
| `tools` | `MCPToolHandler[]` | Tools to expose |
| `resources` | `MCPResourceHandler[]` | Resources to expose |
| `prompts` | `MCPPromptHandler[]` | Prompts to expose |

**Example:**

```ts
import { createMCPServer } from '@utopia/ai/mcp';

const mcp = createMCPServer({
  name: 'my-app',
  version: '1.0.0',
  tools: [{
    definition: {
      name: 'get_user',
      description: 'Look up a user by ID',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'User ID' } },
        required: ['id'],
      },
    },
    handler: async ({ id }) => ({
      content: [{ type: 'text', text: JSON.stringify({ id, name: 'Alice' }) }],
    }),
  }],
  resources: [{
    definition: {
      uri: 'config://app',
      name: 'App Config',
      description: 'Application configuration',
      mimeType: 'application/json',
    },
    handler: async (uri) => ({
      uri,
      text: JSON.stringify({ version: '1.0.0' }),
      mimeType: 'application/json',
    }),
  }],
});
```

The server handles the following JSON-RPC methods: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, and `ping`.

Resource URIs support template matching (e.g. `users://{id}` matches `users://123`).

## MCP Client

### `createMCPClient(config)`

HTTP client that connects to an MCP server.

**MCPClientConfig:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | URL of the MCP server (required) |
| `headers` | `Record<string, string>` | Optional headers for authentication |

**MCPClient methods:**

| Method | Description |
|--------|-------------|
| `initialize()` | Handshake with the server, get capabilities |
| `listTools()` | List available tools |
| `callTool(name, args?)` | Call a tool by name |
| `listResources()` | List available resources |
| `readResource(uri)` | Read a resource by URI |
| `listPrompts()` | List available prompts |
| `getPrompt(name, args?)` | Get a prompt with arguments |
| `toToolHandlers()` | Convert server tools to `ToolHandler[]` for `ai.run()` |

### Bridge Pattern: MCP + AI Tool Loop

The `toToolHandlers()` method bridges MCP tools directly into the `ai.run()` tool-calling loop. This is the core interop pattern:

```ts
import { createAI } from '@utopia/ai';
import { openaiAdapter } from '@utopia/ai/openai';
import { createMCPClient } from '@utopia/ai/mcp';

// Connect to an MCP server
const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
await client.initialize();

// Bridge MCP tools into AI
const ai = createAI(openaiAdapter({ apiKey: process.env.OPENAI_API_KEY! }));
const toolHandlers = await client.toToolHandlers();

const response = await ai.run({
  messages: [{ role: 'user', content: 'Look up user 123' }],
  tools: toolHandlers,
});
```

## MCP HTTP Handler

### `createMCPHandler(server)`

Create a Node.js HTTP handler for an MCP server. Supports three transports:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | JSON-RPC request/response |
| `GET` | `/sse` | Server-Sent Events (Streamable HTTP) |
| `POST` | `/sse` | JSON-RPC over SSE |

CORS headers are set automatically. Use as a standalone server or as Express middleware.

```ts
import http from 'node:http';
import { createMCPServer, createMCPHandler } from '@utopia/ai/mcp';

const mcp = createMCPServer({
  name: 'my-app',
  tools: [/* ... */],
});

const handler = createMCPHandler(mcp);

// Standalone
http.createServer(handler).listen(3001);

// Or as Express middleware
app.use('/mcp', handler);
```

## Middleware & Hooks

`createAI` accepts an options object with hooks and retry configuration.

```ts
const ai = createAI(adapter, {
  hooks: {
    onBeforeChat: (request) => {
      // Modify request before sending
      return { ...request, temperature: 0.7 };
    },
    onAfterChat: (response, request) => {
      // Log or modify response
      console.log(`Used ${response.usage?.totalTokens} tokens`);
      return response;
    },
    onError: (error, context) => {
      console.error(`Error in ${context.method}:`, error);
    },
  },
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
  },
});
```

**AIHooks:**

| Hook | Signature | Description |
|------|-----------|-------------|
| `onBeforeChat` | `(request: ChatRequest) => ChatRequest \| Promise<ChatRequest>` | Modify request before sending. Runs for `chat()`, `stream()`, and each round in `run()`. |
| `onAfterChat` | `(response: ChatResponse, request: ChatRequest) => ChatResponse \| Promise<ChatResponse>` | Modify response after receiving. Runs for `chat()` and each round in `run()`. |
| `onError` | `(error: Error, context: { method: string; request?: ChatRequest }) => void` | Called on any adapter error. |

## Retry

Retry configuration for `chat()` and `run()` (streaming is not retried).

**RetryConfig:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxRetries` | `number` | `0` | Maximum retry attempts |
| `baseDelay` | `number` | `1000` | Base delay in ms (doubles each attempt) |
| `shouldRetry` | `(error: Error) => boolean` | Built-in | Custom retry predicate |

Default retry predicate retries on network errors, timeouts, and HTTP status codes 429, 500, 502, 503.

## Architecture

```
  Application Code
        |
   createAI(adapter, options?)
        |
   ┌────┴────┐
   │   AI    │── hooks (onBeforeChat, onAfterChat, onError)
   │ instance│── retry (exponential backoff)
   └────┬────┘
        │
   ┌────┴──────────────────────────────────┐
   │            AIAdapter                   │
   ├──── openaiAdapter(config)              │
   ├──── anthropicAdapter(config)           │
   ├──── googleAdapter(config)              │
   └──── ollamaAdapter(config)              │
              │                             │
         Provider SDK / HTTP API            │
                                            │
   ┌────────────────────────────────────────┘
   │
   │  MCP Interop
   │
   │  createMCPServer(config)          createMCPClient(config)
   │       │                                │
   │  handleRequest(jsonRpc)           rpc(method, params)
   │       │                                │
   │  createMCPHandler(server)         toToolHandlers()
   │       │                                │
   │  HTTP POST / SSE                  ai.run({ tools })
   │       │                                │
   └───────┴──── JSON-RPC 2.0 ─────────────┘
```

## Type Reference

All types are exported from the main `@utopia/ai` entry point. MCP types are exported from `@utopia/ai/mcp`.

**Core types (`@utopia/ai`):**

| Type | Description |
|------|-------------|
| `AI` | AI instance interface (`chat`, `stream`, `embeddings`, `run`) |
| `AIAdapter` | Adapter interface (implement to add a provider) |
| `CreateAIOptions` | Options for `createAI` (hooks, retry) |
| `ChatRequest` | Chat completion request |
| `ChatResponse` | Chat completion response |
| `ChatChunk` | Streaming chunk |
| `ChatMessage` | Conversation message |
| `MessageRole` | `'system' \| 'user' \| 'assistant' \| 'tool'` |
| `MessageContent` | Union of content types |
| `TextContent` | `{ type: 'text', text: string }` |
| `ImageContent` | `{ type: 'image', source: string, mediaType?: string }` |
| `ToolCallContent` | `{ type: 'tool_call', id, name, arguments }` |
| `ToolResultContent` | `{ type: 'tool_result', id, content, isError? }` |
| `ToolDefinition` | Tool name, description, and JSON Schema parameters |
| `ToolCall` | A tool call from the model (id, name, arguments) |
| `ToolHandler` | Tool definition + handler function for `ai.run()` |
| `RunOptions` | Options for `ai.run()` |
| `TokenUsage` | `{ promptTokens, completionTokens, totalTokens }` |
| `JsonSchema` | JSON Schema type for tool parameters |
| `EmbeddingRequest` | Embedding generation request |
| `EmbeddingResponse` | Embedding generation response |
| `OpenAIConfig` | OpenAI adapter configuration |
| `AnthropicConfig` | Anthropic adapter configuration |
| `GoogleConfig` | Google Gemini adapter configuration |
| `OllamaConfig` | Ollama adapter configuration |
| `AIHooks` | Middleware hooks |
| `RetryConfig` | Retry configuration |

**MCP types (`@utopia/ai/mcp`):**

| Type | Description |
|------|-------------|
| `MCPServer` | Server instance (`handleRequest`, `info`) |
| `MCPClient` | Client instance (all RPC methods + `toToolHandlers`) |
| `MCPServerConfig` | Server configuration (name, version, tools, resources, prompts) |
| `MCPClientConfig` | Client configuration (url, headers) |
| `MCPServerInfo` | Server info (name, version, protocolVersion) |
| `MCPToolDefinition` | Tool schema (name, description, inputSchema) |
| `MCPToolHandler` | Tool definition + handler |
| `MCPToolResult` | Tool execution result (content array, isError) |
| `MCPContent` | Content block (text, image, or resource) |
| `MCPResourceDefinition` | Resource schema (uri, name, description, mimeType) |
| `MCPResourceHandler` | Resource definition + handler |
| `MCPResourceContent` | Resource content (uri, text/blob, mimeType) |
| `MCPPromptDefinition` | Prompt schema (name, description, arguments) |
| `MCPPromptArgument` | Prompt argument (name, description, required) |
| `MCPPromptHandler` | Prompt definition + handler |
| `MCPPromptResult` | Prompt result (description, messages) |
| `JsonRpcRequest` | JSON-RPC 2.0 request |
| `JsonRpcResponse` | JSON-RPC 2.0 response |
| `JsonRpcError` | JSON-RPC 2.0 error |
| `JsonRpcNotification` | JSON-RPC 2.0 notification |
