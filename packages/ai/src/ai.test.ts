// ============================================================================
// @matthesketh/utopia-ai — Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAI } from './ai.js';
import type { CreateAIOptions } from './ai.js';
import { collectStream } from './streaming.js';
import { createMCPServer } from './mcp/server.js';
import type {
  AIAdapter,
  AIHooks,
  RetryConfig,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  MessageContent,
  ImageContent,
  ToolCallContent,
  ToolResultContent,
} from './types.js';
import type {
  MCPToolResult,
  MCPPromptResult,
  MCPResourceContent,
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPPromptDefinition,
  MCPPromptArgument,
} from './mcp/types.js';
import type { ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function mockAdapter(response?: Partial<ChatResponse>): AIAdapter {
  return {
    async chat(_request: ChatRequest): Promise<ChatResponse> {
      return {
        content: 'Hello from mock!',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        ...response,
      };
    },
    async *stream(_request: ChatRequest): AsyncIterable<ChatChunk> {
      const words = (response?.content ?? 'Hello from mock!').split(' ');
      for (const word of words) {
        yield { delta: word + ' ' };
      }
      yield { delta: '', finishReason: 'stop' };
    },
  };
}

// ---------------------------------------------------------------------------
// createAI
// ---------------------------------------------------------------------------

describe('createAI', () => {
  it('should send a chat request through the adapter', async () => {
    const ai = createAI(mockAdapter());
    const result = await ai.chat({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(result.content).toBe('Hello from mock!');
    expect(result.finishReason).toBe('stop');
    expect(result.usage?.totalTokens).toBe(15);
  });

  it('should stream responses', async () => {
    const ai = createAI(mockAdapter({ content: 'one two three' }));
    const text = await collectStream(ai.stream({ messages: [{ role: 'user', content: 'count' }] }));
    expect(text.trim()).toBe('one two three');
  });

  it('should fallback to non-streaming when adapter lacks stream', async () => {
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        return { content: 'no stream', finishReason: 'stop' };
      },
    };
    const ai = createAI(adapter);
    const text = await collectStream(ai.stream({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(text).toBe('no stream');
  });

  it('should throw on embeddings if not supported', () => {
    const ai = createAI(mockAdapter());
    expect(() => ai.embeddings({ input: 'test' })).toThrow('does not support embeddings');
  });

  it('should support embeddings when adapter provides them', async () => {
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        return { content: '', finishReason: 'stop' };
      },
      async embeddings() {
        return { embeddings: [[0.1, 0.2, 0.3]] };
      },
    };
    const ai = createAI(adapter);
    const result = await ai.embeddings({ input: 'hello' });
    expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]]);
  });
});

// ---------------------------------------------------------------------------
// Tool-calling loop (ai.run)
// ---------------------------------------------------------------------------

describe('ai.run - tool calling loop', () => {
  it('should execute a single tool call and return final response', async () => {
    let callCount = 0;

    const adapter: AIAdapter = {
      async chat(request: ChatRequest): Promise<ChatResponse> {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'call_1',
                name: 'get_weather',
                arguments: { city: 'NYC' },
              },
            ],
          };
        }
        return {
          content: 'The weather in NYC is 72F and sunny.',
          finishReason: 'stop',
        };
      },
    };

    const ai = createAI(adapter);
    const onToolCall = vi.fn();

    const result = await ai.run({
      messages: [{ role: 'user', content: 'What is the weather in NYC?' }],
      tools: [
        {
          definition: {
            name: 'get_weather',
            description: 'Get current weather',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string', description: 'City name' },
              },
              required: ['city'],
            },
          },
          handler: async ({ city }) => ({ temp: 72, condition: 'sunny', city }),
        },
      ],
      onToolCall,
    });

    expect(result.content).toBe('The weather in NYC is 72F and sunny.');
    expect(onToolCall).toHaveBeenCalledOnce();
    expect(onToolCall).toHaveBeenCalledWith(
      { id: 'call_1', name: 'get_weather', arguments: { city: 'NYC' } },
      { temp: 72, condition: 'sunny', city: 'NYC' },
    );
  });

  it('should handle unknown tool gracefully', async () => {
    let callCount = 0;

    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'call_1', name: 'unknown_tool', arguments: {} }],
          };
        }
        return { content: 'I could not find that tool.', finishReason: 'stop' };
      },
    };

    const ai = createAI(adapter);
    const result = await ai.run({
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });
    expect(result.content).toBe('I could not find that tool.');
  });

  it('should handle tool errors gracefully', async () => {
    let callCount = 0;

    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'call_1', name: 'failing_tool', arguments: {} }],
          };
        }
        return { content: 'Tool failed, sorry.', finishReason: 'stop' };
      },
    };

    const ai = createAI(adapter);
    const result = await ai.run({
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          definition: {
            name: 'failing_tool',
            description: 'A tool that fails',
            parameters: { type: 'object' },
          },
          handler: async () => {
            throw new Error('Connection timeout');
          },
        },
      ],
    });
    expect(result.content).toBe('Tool failed, sorry.');
  });

  it('should respect maxRounds', async () => {
    let callCount = 0;

    const adapter: AIAdapter = {
      async chat(request: ChatRequest): Promise<ChatResponse> {
        callCount++;
        // Always request tool calls
        if (request.toolChoice === 'none') {
          return { content: 'Max rounds reached.', finishReason: 'stop' };
        }
        return {
          content: '',
          finishReason: 'tool_calls',
          toolCalls: [{ id: `call_${callCount}`, name: 'loop_tool', arguments: {} }],
        };
      },
    };

    const ai = createAI(adapter);
    const result = await ai.run({
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          definition: { name: 'loop_tool', description: 'Loops', parameters: { type: 'object' } },
          handler: async () => 'ok',
        },
      ],
      maxRounds: 3,
    });

    expect(result.content).toBe('Max rounds reached.');
    // 3 rounds of tool calls + 1 final call with toolChoice: 'none'
    expect(callCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

/** Result shape from the MCP `initialize` method. */
interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: { tools?: object; resources?: object; prompts?: object };
  serverInfo: { name: string; version: string };
}

/** Result shape from the MCP `tools/list` method. */
interface MCPToolsListResult {
  tools: Array<Pick<MCPToolDefinition, 'name' | 'description' | 'inputSchema'>>;
}

/** Result shape from the MCP `resources/list` method. */
interface MCPResourcesListResult {
  resources: Array<Pick<MCPResourceDefinition, 'uri' | 'name' | 'description' | 'mimeType'>>;
}

/** Result shape from the MCP `resources/read` method. */
interface MCPResourcesReadResult {
  contents: MCPResourceContent[];
}

/** Result shape from the MCP `prompts/list` method. */
interface MCPPromptsListResult {
  prompts: Array<
    Pick<MCPPromptDefinition, 'name' | 'description'> & { arguments?: MCPPromptArgument[] }
  >;
}

describe('MCP Server', () => {
  function createTestServer() {
    return createMCPServer({
      name: 'test-server',
      version: '1.0.0',
      tools: [
        {
          definition: {
            name: 'add',
            description: 'Add two numbers',
            inputSchema: {
              type: 'object',
              properties: {
                a: { type: 'number', description: 'First number' },
                b: { type: 'number', description: 'Second number' },
              },
              required: ['a', 'b'],
            },
          },
          handler: async (params) => ({
            content: [{ type: 'text', text: String(Number(params.a) + Number(params.b)) }],
          }),
        },
      ],
      resources: [
        {
          definition: {
            uri: 'config://app',
            name: 'App Configuration',
            description: 'Current app config',
            mimeType: 'application/json',
          },
          handler: async () => ({
            uri: 'config://app',
            text: JSON.stringify({ theme: 'dark', lang: 'en' }),
            mimeType: 'application/json',
          }),
        },
      ],
      prompts: [
        {
          definition: {
            name: 'greeting',
            description: 'Generate a greeting',
            arguments: [{ name: 'name', required: true }],
          },
          handler: async (args) => ({
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: `Say hello to ${args.name}` },
              },
            ],
          }),
        },
      ],
    });
  }

  it('should handle initialize', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as MCPInitializeResult;
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo.name).toBe('test-server');
    expect(result.capabilities.tools).toBeDefined();
    expect(result.capabilities.resources).toBeDefined();
    expect(result.capabilities.prompts).toBeDefined();
  });

  it('should list tools', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    const result = response.result as MCPToolsListResult;
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('add');
  });

  it('should call a tool', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 3, b: 4 } },
    });

    const result = response.result as MCPToolResult;
    expect(result.content[0].text).toBe('7');
  });

  it('should return error for unknown tool', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'nonexistent' },
    });

    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('Unknown tool');
  });

  it('should list resources', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/list',
    });

    const result = response.result as MCPResourcesListResult;
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].uri).toBe('config://app');
  });

  it('should read a resource', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'resources/read',
      params: { uri: 'config://app' },
    });

    const result = response.result as MCPResourcesReadResult;
    expect(result.contents[0].uri).toBe('config://app');
    const parsed = JSON.parse(result.contents[0].text!);
    expect(parsed.theme).toBe('dark');
  });

  it('should list prompts', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'prompts/list',
    });

    const result = response.result as MCPPromptsListResult;
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].name).toBe('greeting');
  });

  it('should get a prompt', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 8,
      method: 'prompts/get',
      params: { name: 'greeting', arguments: { name: 'Alice' } },
    });

    const result = response.result as MCPPromptResult;
    expect(result.messages[0].content.text).toBe('Say hello to Alice');
  });

  it('should handle ping', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 9,
      method: 'ping',
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({});
  });

  it('should return error for unknown method', async () => {
    const server = createTestServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'unknown/method',
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32601);
  });

  it('should report server info', () => {
    const server = createTestServer();
    const info = server.info();
    expect(info.name).toBe('test-server');
    expect(info.version).toBe('1.0.0');
  });
});

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

describe('collectStream', () => {
  it('should collect async iterable into a string', async () => {
    async function* gen(): AsyncIterable<ChatChunk> {
      yield { delta: 'Hello ' };
      yield { delta: 'World' };
      yield { delta: '', finishReason: 'stop' };
    }
    const result = await collectStream(gen());
    expect(result).toBe('Hello World');
  });
});

// ---------------------------------------------------------------------------
// streamSSE
// ---------------------------------------------------------------------------

import { streamSSE, parseSSEStream } from './streaming.js';

function mockRes() {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & {
    writeHead: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

function mockFetchResponse(chunks: string[]): Response {
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
  return { body: stream } as Response;
}

describe('streamSSE', () => {
  it('should set correct SSE headers', async () => {
    const res = mockRes();
    async function* emptyStream(): AsyncIterable<ChatChunk> {
      // no chunks
    }

    await streamSSE(res, emptyStream());

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  });

  it('should write each chunk as data: JSON\\n\\n', async () => {
    const res = mockRes();
    async function* twoChunks(): AsyncIterable<ChatChunk> {
      yield { delta: 'Hello' };
      yield { delta: ' World', finishReason: 'stop' };
    }

    await streamSSE(res, twoChunks());

    // Two data writes for chunks + 1 for [DONE]
    const writes = res.write.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(writes).toHaveLength(3);

    // First chunk
    const parsed0 = JSON.parse(writes[0].replace('data: ', '').trim());
    expect(parsed0.delta).toBe('Hello');

    // Second chunk
    const parsed1 = JSON.parse(writes[1].replace('data: ', '').trim());
    expect(parsed1.delta).toBe(' World');
    expect(parsed1.finishReason).toBe('stop');
  });

  it('should end with data: [DONE]\\n\\n', async () => {
    const res = mockRes();
    async function* oneChunk(): AsyncIterable<ChatChunk> {
      yield { delta: 'Hi' };
    }

    await streamSSE(res, oneChunk());

    const writes = res.write.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(writes[writes.length - 1]).toBe('data: [DONE]\n\n');
    expect(res.end).toHaveBeenCalled();
  });

  it('should call onChunk callback for each chunk', async () => {
    const res = mockRes();
    const onChunk = vi.fn();

    async function* threeChunks(): AsyncIterable<ChatChunk> {
      yield { delta: 'a' };
      yield { delta: 'b' };
      yield { delta: 'c' };
    }

    await streamSSE(res, threeChunks(), { onChunk });

    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onChunk).toHaveBeenNthCalledWith(1, { delta: 'a' });
    expect(onChunk).toHaveBeenNthCalledWith(2, { delta: 'b' });
    expect(onChunk).toHaveBeenNthCalledWith(3, { delta: 'c' });
  });
});

// ---------------------------------------------------------------------------
// parseSSEStream
// ---------------------------------------------------------------------------

describe('parseSSEStream', () => {
  it('should parse valid SSE data lines', async () => {
    const response = mockFetchResponse([
      'data: {"delta":"Hello"}\n\ndata: {"delta":" World"}\n\n',
      'data: [DONE]\n\n',
    ]);

    const chunks: ChatChunk[] = [];
    for await (const chunk of parseSSEStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].delta).toBe('Hello');
    expect(chunks[1].delta).toBe(' World');
  });

  it('should stop on [DONE] marker', async () => {
    const response = mockFetchResponse([
      'data: {"delta":"first"}\n\n',
      'data: [DONE]\n\n',
      'data: {"delta":"should not appear"}\n\n',
    ]);

    const chunks: ChatChunk[] = [];
    for await (const chunk of parseSSEStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].delta).toBe('first');
  });

  it('should skip malformed JSON data gracefully', async () => {
    const response = mockFetchResponse([
      'data: {"delta":"valid"}\n\n',
      'data: {not valid json}\n\n',
      'data: {"delta":"also valid"}\n\n',
      'data: [DONE]\n\n',
    ]);

    const chunks: ChatChunk[] = [];
    for await (const chunk of parseSSEStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].delta).toBe('valid');
    expect(chunks[1].delta).toBe('also valid');
  });

  it('should handle multiple malformed lines interspersed with valid ones', async () => {
    const response = mockFetchResponse([
      'data: not-json-at-all\n\n',
      'data: {"delta":"first"}\n\n',
      'data: {truncated\n\n',
      'data: \n\n',
      'data: {"delta":"second","finishReason":"stop"}\n\n',
      'data: [DONE]\n\n',
    ]);

    const chunks: ChatChunk[] = [];
    for await (const chunk of parseSSEStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].delta).toBe('first');
    expect(chunks[1].delta).toBe('second');
    expect(chunks[1].finishReason).toBe('stop');
  });

  it('should clean up the reader via cancel on normal completion', async () => {
    const cancelFn = vi.fn().mockResolvedValue(undefined);
    let index = 0;
    const sseData = ['data: {"delta":"hello"}\n\n', 'data: [DONE]\n\n'];

    const stream = new ReadableStream({
      pull(controller) {
        if (index < sseData.length) {
          controller.enqueue(new TextEncoder().encode(sseData[index++]));
        } else {
          controller.close();
        }
      },
    });

    // Override getReader to intercept cancel
    const originalGetReader = stream.getReader.bind(stream);
    const reader = originalGetReader();
    const originalRead = reader.read.bind(reader);
    const originalCancel = reader.cancel.bind(reader);

    let readerRequested = false;
    const mockStream = new ReadableStream(); // dummy, won't be used
    const response = {
      body: {
        getReader() {
          readerRequested = true;
          return {
            read: originalRead,
            cancel: cancelFn,
            releaseLock: reader.releaseLock.bind(reader),
          };
        },
      },
    } as unknown as Response;

    const chunks: ChatChunk[] = [];
    for await (const chunk of parseSSEStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].delta).toBe('hello');
    expect(readerRequested).toBe(true);
    // The finally block should call reader.cancel()
    expect(cancelFn).toHaveBeenCalled();
  });

  it('should clean up the reader even when iteration is aborted early', async () => {
    const cancelFn = vi.fn().mockResolvedValue(undefined);
    let index = 0;
    const sseData = [
      'data: {"delta":"chunk1"}\n\n',
      'data: {"delta":"chunk2"}\n\n',
      'data: {"delta":"chunk3"}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = new ReadableStream({
      pull(controller) {
        if (index < sseData.length) {
          controller.enqueue(new TextEncoder().encode(sseData[index++]));
        } else {
          controller.close();
        }
      },
    });

    const reader = stream.getReader();
    const originalRead = reader.read.bind(reader);

    const response = {
      body: {
        getReader() {
          return {
            read: originalRead,
            cancel: cancelFn,
            releaseLock: reader.releaseLock.bind(reader),
          };
        },
      },
    } as unknown as Response;

    const chunks: ChatChunk[] = [];
    for await (const chunk of parseSSEStream(response)) {
      chunks.push(chunk);
      if (chunks.length === 1) break; // Abort early after first chunk
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].delta).toBe('chunk1');
    // The finally block should still call reader.cancel() even on early break
    expect(cancelFn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Multi-tool call tests
// ---------------------------------------------------------------------------

describe('ai.run - multiple tool calls in one round', () => {
  it('should execute 2+ tool calls in a single round and append results as separate messages', async () => {
    let callCount = 0;
    const chatSpy = vi.fn();

    const adapter: AIAdapter = {
      async chat(request: ChatRequest): Promise<ChatResponse> {
        callCount++;
        chatSpy(request);

        if (callCount === 1) {
          return {
            content: '',
            finishReason: 'tool_calls',
            toolCalls: [
              { id: 'call_a', name: 'get_weather', arguments: { city: 'NYC' } },
              { id: 'call_b', name: 'get_time', arguments: { timezone: 'EST' } },
            ],
          };
        }
        return {
          content: 'NYC is 72F and the time is 3pm EST.',
          finishReason: 'stop',
        };
      },
    };

    const ai = createAI(adapter);
    const onToolCall = vi.fn();

    const result = await ai.run({
      messages: [{ role: 'user', content: 'Weather and time in NYC?' }],
      tools: [
        {
          definition: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
          handler: async ({ city }) => ({ temp: 72, city }),
        },
        {
          definition: {
            name: 'get_time',
            description: 'Get current time',
            parameters: {
              type: 'object',
              properties: { timezone: { type: 'string' } },
              required: ['timezone'],
            },
          },
          handler: async ({ timezone }) => ({ time: '3:00 PM', timezone }),
        },
      ],
      onToolCall,
    });

    expect(result.content).toBe('NYC is 72F and the time is 3pm EST.');
    expect(onToolCall).toHaveBeenCalledTimes(2);

    // Verify the second call to the adapter includes both tool results
    const secondCallRequest = chatSpy.mock.calls[1][0] as ChatRequest;
    const messages = secondCallRequest.messages;

    // Should have: user, assistant (tool_calls), tool_result for weather, tool_result for time
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('tool');
    expect(messages[3].role).toBe('tool');

    // Verify assistant message contains both tool calls
    const assistantContent = messages[1].content as ToolCallContent[];
    expect(assistantContent).toHaveLength(2);
    expect(assistantContent[0].name).toBe('get_weather');
    expect(assistantContent[1].name).toBe('get_time');

    // Verify tool result messages
    const toolResult0 = (messages[2].content as ToolResultContent[])[0];
    expect(toolResult0.type).toBe('tool_result');
    expect(toolResult0.id).toBe('call_a');

    const toolResult1 = (messages[3].content as ToolResultContent[])[0];
    expect(toolResult1.type).toBe('tool_result');
    expect(toolResult1.id).toBe('call_b');
  });
});

// ---------------------------------------------------------------------------
// Edge case tests
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle chat with messages containing images', async () => {
    const chatSpy = vi.fn();

    const adapter: AIAdapter = {
      async chat(request: ChatRequest): Promise<ChatResponse> {
        chatSpy(request);
        return {
          content: 'I see a cat in the image.',
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
        };
      },
    };

    const ai = createAI(adapter);
    const result = await ai.chat({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            {
              type: 'image',
              source: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
              mediaType: 'image/png',
            },
          ],
        },
      ],
    });

    expect(result.content).toBe('I see a cat in the image.');

    // Verify the request was passed through with multimodal content
    const sentRequest = chatSpy.mock.calls[0][0] as ChatRequest;
    const content = sentRequest.messages[0].content as Exclude<MessageContent, string>[];
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe('text');
    expect(content[1].type).toBe('image');
    expect((content[1] as ImageContent).source).toBe('data:image/png;base64,iVBORw0KGgoAAAANS...');
  });

  it('should handle tool call with empty arguments {}', async () => {
    let callCount = 0;

    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'call_empty', name: 'get_status', arguments: {} }],
          };
        }
        return { content: 'System is healthy.', finishReason: 'stop' };
      },
    };

    const ai = createAI(adapter);
    const handler = vi.fn().mockResolvedValue({ status: 'ok' });

    const result = await ai.run({
      messages: [{ role: 'user', content: 'Check system status' }],
      tools: [
        {
          definition: {
            name: 'get_status',
            description: 'Get system status',
            parameters: { type: 'object' },
          },
          handler,
        },
      ],
    });

    expect(result.content).toBe('System is healthy.');
    expect(handler).toHaveBeenCalledWith({});
  });

  it('should handle streaming chunks without usage info', async () => {
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        return { content: '', finishReason: 'stop' };
      },
      async *stream(): AsyncIterable<ChatChunk> {
        yield { delta: 'chunk1' };
        yield { delta: 'chunk2' };
        yield { delta: '', finishReason: 'stop' };
        // Note: no usage field on any chunk
      },
    };

    const ai = createAI(adapter);
    const chunks: ChatChunk[] = [];

    for await (const chunk of ai.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].delta).toBe('chunk1');
    expect(chunks[0].usage).toBeUndefined();
    expect(chunks[1].delta).toBe('chunk2');
    expect(chunks[1].usage).toBeUndefined();
    expect(chunks[2].finishReason).toBe('stop');
    expect(chunks[2].usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Hooks & Middleware
// ---------------------------------------------------------------------------

describe('hooks', () => {
  it('onBeforeChat should modify the request', async () => {
    const chatSpy = vi.fn().mockResolvedValue({
      content: 'response',
      finishReason: 'stop',
    } as ChatResponse);

    const adapter: AIAdapter = { chat: chatSpy };

    const ai = createAI(adapter, {
      hooks: {
        onBeforeChat: (req) => ({
          ...req,
          model: 'gpt-4',
          temperature: 0,
        }),
      },
    });

    await ai.chat({ messages: [{ role: 'user', content: 'Hi' }] });

    const sentReq = chatSpy.mock.calls[0][0] as ChatRequest;
    expect(sentReq.model).toBe('gpt-4');
    expect(sentReq.temperature).toBe(0);
  });

  it('onAfterChat should modify the response', async () => {
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        return { content: 'original', finishReason: 'stop' };
      },
    };

    const ai = createAI(adapter, {
      hooks: {
        onAfterChat: (res) => ({ ...res, content: res.content + ' [modified]' }),
      },
    });

    const result = await ai.chat({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(result.content).toBe('original [modified]');
  });

  it('onError should be called on adapter failure', async () => {
    const onError = vi.fn();
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        throw new Error('network timeout');
      },
    };

    const ai = createAI(adapter, { hooks: { onError } });

    await expect(ai.chat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
      'network timeout',
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toBe('network timeout');
    expect(onError.mock.calls[0][1].method).toBe('chat');
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe('retry', () => {
  it('should retry on transient error then succeed', async () => {
    let attempt = 0;
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        attempt++;
        if (attempt < 3) {
          throw new Error('network error');
        }
        return { content: 'success', finishReason: 'stop' };
      },
    };

    const ai = createAI(adapter, {
      retry: { maxRetries: 3, baseDelay: 1 },
    });

    const result = await ai.chat({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(result.content).toBe('success');
    expect(attempt).toBe(3);
  });

  it('should give up after maxRetries', async () => {
    let attempt = 0;
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        attempt++;
        throw new Error('500 internal server error');
      },
    };

    const ai = createAI(adapter, {
      retry: { maxRetries: 2, baseDelay: 1 },
    });

    await expect(ai.chat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
      '500 internal server error',
    );
    // 1 initial + 2 retries = 3 total attempts
    expect(attempt).toBe(3);
  });

  it('should not retry non-retryable errors', async () => {
    let attempt = 0;
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        attempt++;
        throw new Error('Invalid API key');
      },
    };

    const ai = createAI(adapter, {
      retry: { maxRetries: 3, baseDelay: 1 },
    });

    await expect(ai.chat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
      'Invalid API key',
    );
    // Should not retry — only 1 attempt
    expect(attempt).toBe(1);
  });

  it('should apply exponential backoff timing', async () => {
    vi.useFakeTimers();

    let attempt = 0;
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        attempt++;
        if (attempt <= 3) {
          throw new Error('429 rate limited');
        }
        return { content: 'ok', finishReason: 'stop' };
      },
    };

    const ai = createAI(adapter, {
      retry: { maxRetries: 3, baseDelay: 1000 },
    });

    const promise = ai.chat({ messages: [{ role: 'user', content: 'Hi' }] });

    // attempt 1 fails immediately -> waits 1000ms (1000 * 2^0)
    await vi.advanceTimersByTimeAsync(1000);
    // attempt 2 fails -> waits 2000ms (1000 * 2^1)
    await vi.advanceTimersByTimeAsync(2000);
    // attempt 3 fails -> waits 4000ms (1000 * 2^2)
    await vi.advanceTimersByTimeAsync(4000);
    // attempt 4 succeeds

    const result = await promise;
    expect(result.content).toBe('ok');
    expect(attempt).toBe(4);

    vi.useRealTimers();
  });

  it('should apply retry in run() method', async () => {
    let chatAttempt = 0;
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        chatAttempt++;
        if (chatAttempt === 1) {
          throw new Error('503 service unavailable');
        }
        return { content: 'run result', finishReason: 'stop' };
      },
    };

    const ai = createAI(adapter, {
      retry: { maxRetries: 2, baseDelay: 1 },
    });

    const result = await ai.run({
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.content).toBe('run result');
    expect(chatAttempt).toBe(2);
  });

  it('should use custom shouldRetry function', async () => {
    let attempt = 0;
    const adapter: AIAdapter = {
      async chat(): Promise<ChatResponse> {
        attempt++;
        throw new Error('custom-retryable');
      },
    };

    const ai = createAI(adapter, {
      retry: {
        maxRetries: 2,
        baseDelay: 1,
        shouldRetry: (err) => err.message.includes('custom-retryable'),
      },
    });

    await expect(ai.chat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
      'custom-retryable',
    );
    // 1 initial + 2 retries = 3
    expect(attempt).toBe(3);
  });
});
