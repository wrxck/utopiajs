// regression tests for the v0.8 mcp hardening pass: authorisation gate,
// origin allow-listing, json-rpc argument validation, internal-error
// redaction, and client endpoint validation.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, it, expect } from 'vitest';

import { createMCPServer } from './server';
import { createMCPHandler } from './handler';
import type { MCPHandlerOptions } from './handler';
import { createMCPClient } from './client';

interface Captured {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function drive(
  server: ReturnType<typeof createMCPServer>,
  options: MCPHandlerOptions,
  req: Partial<IncomingMessage> & { headers: Record<string, string> },
): Promise<Captured> {
  const handler = createMCPHandler(server, options);
  return new Promise((resolve) => {
    const captured: Captured = { statusCode: 0, headers: {}, body: '' };
    const res = {
      setHeader(k: string, v: string) {
        captured.headers[k] = v;
      },
      writeHead(status: number, headers?: Record<string, string>) {
        captured.statusCode = status;
        if (headers) Object.assign(captured.headers, headers);
        return res;
      },
      end(body?: string) {
        captured.body = body ?? '';
        resolve(captured);
      },
    } as unknown as ServerResponse;
    handler(req as IncomingMessage, res);
  });
}

function serverWithTool(onCall: () => void) {
  return createMCPServer({
    name: 'test',
    tools: [
      {
        definition: {
          name: 'echo',
          description: 'echo',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
        handler: async (args) => {
          onCall();
          return { content: [{ type: 'text', text: String(args.id) }] };
        },
      },
    ],
  });
}

describe('MCP handler authorisation gate', () => {
  it('rejects with 401 and never dispatches when authorize returns false', async () => {
    let called = false;
    const res = await drive(
      serverWithTool(() => {
        called = true;
      }),
      { authorize: () => false },
      { method: 'POST', url: '/', headers: { host: 'localhost' } },
    );
    expect(res.statusCode).toBe(401);
    expect(called).toBeFalsy();
  });
});

describe('MCP handler origin allow-list', () => {
  it('rejects a disallowed Origin with 403 (dns-rebinding defence)', async () => {
    const res = await drive(
      serverWithTool(() => {}),
      { allowedOrigins: ['https://ok.test'] },
      { method: 'POST', url: '/', headers: { host: 'localhost', origin: 'https://evil.test' } },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('MCP server argument validation', () => {
  const server = serverWithTool(() => {});

  it('rejects tools/call with a missing required argument', async () => {
    const out = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo', arguments: {} },
    });
    expect(out.error?.code).toBe(-32602);
  });

  it('rejects tools/call with a wrong-typed argument', async () => {
    const out = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'echo', arguments: { id: 123 } },
    });
    expect(out.error?.code).toBe(-32602);
  });

  it('rejects non-object params', async () => {
    const out = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: 'not-an-object' as unknown as Record<string, unknown>,
    });
    expect(out.error?.code).toBe(-32602);
  });
});

describe('MCP server internal-error redaction', () => {
  it('does not echo a raw handler exception back to the caller', async () => {
    const server = createMCPServer({
      name: 'test',
      tools: [
        {
          definition: { name: 'boom', description: 'boom', inputSchema: { type: 'object' } },
          handler: async () => {
            throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
          },
        },
      ],
    });
    const out = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'boom', arguments: {} },
    });
    expect(out.error?.code).toBe(-32603);
    expect(out.error?.message).toBe('Internal error');
    expect(JSON.stringify(out)).not.toContain('ECONNREFUSED');
  });
});

describe('MCP client endpoint validation', () => {
  it('rejects a non-http(s) url', () => {
    expect(() => createMCPClient({ url: 'file:///etc/passwd' })).toThrow();
  });

  it('accepts an http(s) url', () => {
    expect(() => createMCPClient({ url: 'https://mcp.example.test/rpc' })).not.toThrow();
  });
});
