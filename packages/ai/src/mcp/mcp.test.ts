// ============================================================================
// @matthesketh/utopia-ai — MCP Handler & Client Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { createMCPHandler } from './handler.js';
import { createMCPClient } from './client.js';
import { createMCPServer } from './server.js';
import type { MCPServer } from './server.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mockReq(method: string, url: string, body?: string) {
  const req = new EventEmitter() as any;
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost' };
  if (body) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  } else {
    process.nextTick(() => req.emit('end'));
  }
  return req;
}

function mockRes() {
  const res = {
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    _headers: {} as Record<string, string>,
    _body: '',
    _status: 200,
  };
  res.writeHead.mockImplementation((status: number, headers?: any) => {
    res._status = status;
    if (headers) Object.assign(res._headers, headers);
  });
  res.end.mockImplementation((data?: string) => {
    if (data) res._body = data;
  });
  return res;
}

function createTestServer(): MCPServer {
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
  });
}

// ---------------------------------------------------------------------------
// MCP Handler Tests
// ---------------------------------------------------------------------------

describe('MCP Handler', () => {
  let server: MCPServer;
  let handler: ReturnType<typeof createMCPHandler>;

  beforeEach(() => {
    server = createTestServer();
    handler = createMCPHandler(server);
  });

  it('should return valid JSON-RPC response for POST request', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    });

    const req = mockReq('POST', '/', body);
    const res = mockRes();

    handler(req, res as any);

    // Wait for the async handler to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('application/json');

    const parsed = JSON.parse(res._body);
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe(1);
    expect(parsed.result.protocolVersion).toBe('2024-11-05');
    expect(parsed.result.serverInfo.name).toBe('test-server');
  });

  it('should set CORS headers on OPTIONS request', async () => {
    const req = mockReq('OPTIONS', '/');
    const res = mockRes();

    handler(req, res as any);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    expect(res._status).toBe(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('should return parse error for malformed JSON', async () => {
    const req = mockReq('POST', '/', '{not valid json!!!');
    const res = mockRes();

    handler(req, res as any);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(res._status).toBe(400);
    expect(res._headers['Content-Type']).toBe('application/json');

    const parsed = JSON.parse(res._body);
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBeNull();
    expect(parsed.error.code).toBe(-32700);
    expect(parsed.error.message).toBe('Parse error');
  });

  it('should set correct SSE headers on GET /sse', async () => {
    const req = mockReq('GET', '/sse');
    const res = mockRes();

    handler(req, res as any);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/event-stream');
    expect(res._headers['Cache-Control']).toBe('no-cache');
    expect(res._headers['Connection']).toBe('keep-alive');

    // Should send endpoint event
    expect(res.write).toHaveBeenCalledWith('event: endpoint\ndata: ./\n\n');
  });

  it('should return 405 for non-POST/GET methods', async () => {
    const req = mockReq('PUT', '/');
    const res = mockRes();

    handler(req, res as any);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(res._status).toBe(405);
    expect(res._headers['Content-Type']).toBe('text/plain');
    expect(res._body).toBe('Method Not Allowed');
  });

  it('should return 405 for DELETE method', async () => {
    const req = mockReq('DELETE', '/resource');
    const res = mockRes();

    handler(req, res as any);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(res._status).toBe(405);
  });

  it('should set CORS headers on all request types', async () => {
    const req = mockReq('PUT', '/');
    const res = mockRes();

    handler(req, res as any);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // CORS headers should be set even on 405 responses
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
  });

  it('should handle tools/call via POST', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 10, b: 20 } },
    });

    const req = mockReq('POST', '/', body);
    const res = mockRes();

    handler(req, res as any);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(res._status).toBe(200);
    const parsed = JSON.parse(res._body);
    expect(parsed.id).toBe(42);
    expect(parsed.result.content[0].text).toBe('30');
  });
});

// ---------------------------------------------------------------------------
// MCP Client Tests
// ---------------------------------------------------------------------------

describe('MCP Client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  function mockFetchResponse(result: unknown, id: number = 1) {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id,
        result,
      }),
      text: async () => JSON.stringify({ jsonrpc: '2.0', id, result }),
    });
  }

  it('initialize() should send correct JSON-RPC request', async () => {
    const serverResult = {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'remote-server', version: '2.0.0' },
      capabilities: { tools: {} },
    };
    mockFetchResponse(serverResult);

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    const result = await client.initialize();

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, options] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('http://localhost:3001/mcp');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('initialize');
    expect(body.params.protocolVersion).toBe('2024-11-05');
    expect(body.params.clientInfo.name).toBe('utopia-mcp-client');

    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo.name).toBe('remote-server');
  });

  it('listTools() should return tool definitions', async () => {
    const tools = [
      {
        name: 'get_weather',
        description: 'Get weather for a city',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
      {
        name: 'search',
        description: 'Search the web',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
    ];
    mockFetchResponse({ tools });

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    const result = await client.listTools();

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('get_weather');
    expect(result[1].name).toBe('search');

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.method).toBe('tools/list');
  });

  it('callTool() should send correct params and return result', async () => {
    const toolResult = {
      content: [{ type: 'text', text: '72F and sunny' }],
      isError: false,
    };
    mockFetchResponse(toolResult);

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    const result = await client.callTool('get_weather', { city: 'NYC' });

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('get_weather');
    expect(body.params.arguments).toEqual({ city: 'NYC' });

    expect(result.content[0].text).toBe('72F and sunny');
    expect(result.isError).toBe(false);
  });

  it('listResources() should return resource definitions', async () => {
    const resources = [{ uri: 'config://app', name: 'App Config', mimeType: 'application/json' }];
    mockFetchResponse({ resources });

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    const result = await client.listResources();

    expect(result).toHaveLength(1);
    expect(result[0].uri).toBe('config://app');
    expect(result[0].name).toBe('App Config');

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.method).toBe('resources/list');
  });

  it('readResource() should return resource content', async () => {
    const content = {
      contents: [
        {
          uri: 'config://app',
          text: '{"theme":"dark"}',
          mimeType: 'application/json',
        },
      ],
    };
    mockFetchResponse(content);

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    const result = await client.readResource('config://app');

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.method).toBe('resources/read');
    expect(body.params.uri).toBe('config://app');

    expect(result.uri).toBe('config://app');
    expect(result.text).toBe('{"theme":"dark"}');
  });

  it('toToolHandlers() should convert MCP tools to AI-compatible ToolHandler[]', async () => {
    // First call: listTools
    mockFetchResponse({
      tools: [
        {
          name: 'add',
          description: 'Add two numbers',
          inputSchema: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['a', 'b'],
          },
        },
      ],
    });

    // Second call: callTool (when we invoke the handler)
    mockFetchResponse({
      content: [{ type: 'text', text: '7' }],
      isError: false,
    });

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    const handlers = await client.toToolHandlers();

    expect(handlers).toHaveLength(1);
    expect(handlers[0].definition.name).toBe('add');
    expect(handlers[0].definition.description).toBe('Add two numbers');
    expect(handlers[0].definition.parameters).toEqual({
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    });

    // Execute the handler to verify it calls callTool
    const result = await handlers[0].handler({ a: 3, b: 4 });
    expect(result).toBe('7');
  });

  it('toToolHandlers() handler should throw on tool error', async () => {
    // First call: listTools
    mockFetchResponse({
      tools: [
        {
          name: 'fail_tool',
          description: 'A tool that fails',
          inputSchema: { type: 'object' },
        },
      ],
    });

    // Second call: callTool returns isError: true
    mockFetchResponse({
      content: [{ type: 'text', text: 'Something went wrong' }],
      isError: true,
    });

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    const handlers = await client.toToolHandlers();

    await expect(handlers[0].handler({})).rejects.toThrow('Something went wrong');
  });

  it('should throw on JSON-RPC error from server', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32602,
          message: 'Unknown tool: nonexistent',
          data: undefined,
        },
      }),
      text: async () => '{}',
    });

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });

    await expect(client.callTool('nonexistent', {})).rejects.toThrow('Unknown tool: nonexistent');

    try {
      // Reset the mock for a second attempt
      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 2,
          error: { code: -32601, message: 'Method not found' },
        }),
        text: async () => '{}',
      });
      await client.listTools();
    } catch (err: any) {
      expect(err.message).toBe('Method not found');
      expect(err.code).toBe(-32601);
    }
  });

  it('should throw on network failure', async () => {
    (globalThis.fetch as any).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });

    await expect(client.initialize()).rejects.toThrow('Failed to fetch');
  });

  it('should throw on non-ok HTTP response', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });

    await expect(client.initialize()).rejects.toThrow(
      'MCP server error 500: Internal Server Error',
    );
  });

  it('should send custom headers when configured', async () => {
    mockFetchResponse({ tools: [] });

    const client = createMCPClient({
      url: 'http://localhost:3001/mcp',
      headers: { Authorization: 'Bearer token123' },
    });

    await client.listTools();

    const [, options] = (globalThis.fetch as any).mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer token123');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('should increment request IDs', async () => {
    mockFetchResponse({ tools: [] });
    mockFetchResponse({ resources: [] });

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    await client.listTools();
    await client.listResources();

    const body1 = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const body2 = JSON.parse((globalThis.fetch as any).mock.calls[1][1].body);
    expect(body1.id).toBe(1);
    expect(body2.id).toBe(2);
  });

  it('listTools() should return empty array when server returns no tools', async () => {
    mockFetchResponse({});

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    const result = await client.listTools();

    expect(result).toEqual([]);
  });

  it('listResources() should return empty array when server returns no resources', async () => {
    mockFetchResponse({});

    const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
    const result = await client.listResources();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MCP Server — Template URI Regex Injection
// ---------------------------------------------------------------------------

describe('MCP Server — template URI matching with regex special characters', () => {
  it('should match a resource URI with dots treated as literal characters', async () => {
    const server = createMCPServer({
      name: 'regex-test',
      resources: [
        {
          definition: {
            uri: 'config://app.json',
            name: 'App Config JSON',
            description: 'App configuration file',
            mimeType: 'application/json',
          },
          handler: async () => ({
            uri: 'config://app.json',
            text: '{"ok":true}',
            mimeType: 'application/json',
          }),
        },
      ],
    });

    // Exact match should work
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'config://app.json' },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as any;
    expect(result.contents[0].uri).toBe('config://app.json');
    expect(result.contents[0].text).toBe('{"ok":true}');
  });

  it('should NOT match a URI where dots are treated as regex wildcards', async () => {
    const server = createMCPServer({
      name: 'regex-test',
      resources: [
        {
          definition: {
            uri: 'config://app.json',
            name: 'App Config JSON',
            description: 'App configuration file',
            mimeType: 'application/json',
          },
          handler: async () => ({
            uri: 'config://app.json',
            text: '{"ok":true}',
            mimeType: 'application/json',
          }),
        },
      ],
    });

    // "appXjson" should NOT match "app.json" — the dot must be literal
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/read',
      params: { uri: 'config://appXjson' },
    });

    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain('Unknown resource');
  });

  it('should still support template parameters with regex special chars in the base URI', async () => {
    const server = createMCPServer({
      name: 'regex-test',
      resources: [
        {
          definition: {
            uri: 'files://docs/{filename}.md',
            name: 'Markdown files',
            description: 'Read a markdown doc',
            mimeType: 'text/markdown',
          },
          handler: async (uri) => ({
            uri,
            text: `# Content for ${uri}`,
            mimeType: 'text/markdown',
          }),
        },
      ],
    });

    // Template parameter should match
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'files://docs/readme.md' },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as any;
    expect(result.contents[0].uri).toBe('files://docs/readme.md');

    // But the dot in ".md" should be literal — "Xmd" should NOT match
    const badResponse = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { uri: 'files://docs/readmeXmd' },
    });

    expect(badResponse.error).toBeDefined();
    expect(badResponse.error!.message).toContain('Unknown resource');
  });
});
