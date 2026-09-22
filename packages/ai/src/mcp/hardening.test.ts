// regression tests for the v0.8 mcp hardening pass: authorisation gate,
// origin allow-listing, json-rpc argument validation, internal-error
// redaction, and client endpoint validation.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createMCPClient } from '@/mcp/client';
import type { MCPHandlerOptions } from '@/mcp/handler';
import { createMCPHandler } from '@/mcp/handler';
import { createMCPServer } from '@/mcp/server';

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

describe('origin validation without an allow-list', () => {
  const post = (origin: string | undefined) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo', arguments: { id: 'x' } },
    });
    const req = Object.assign(Readable.from([Buffer.from(body)]), {
      method: 'POST',
      url: '/',
      headers:
        origin === undefined ? { host: 'localhost:3001' } : { host: 'localhost:3001', origin },
    });
    return req as unknown as Partial<IncomingMessage> & { headers: Record<string, string> };
  };

  it('rejects a foreign browser origin, as a dns-rebinding page would send', async () => {
    let calls = 0;
    const res = await drive(
      serverWithTool(() => calls++),
      { authorize: () => true },
      post('http://evil.example'),
    );
    expect(res.statusCode).toBe(403);
    expect(calls).toBe(0);
  });

  it('accepts loopback origins, the configured cors origin, and origin-less clients', async () => {
    const server = serverWithTool(() => {});
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:3000', undefined]) {
      const res = await drive(server, { authorize: () => true }, post(origin));
      expect(res.statusCode).toBe(200);
    }
    const cors = await drive(
      server,
      { authorize: () => true, corsOrigin: 'https://app.example' },
      post('https://app.example'),
    );
    expect(cors.statusCode).toBe(200);
  });

  it('keeps a wildcard cors origin as an explicit opt-out', async () => {
    const res = await drive(
      serverWithTool(() => {}),
      { authorize: () => true, corsOrigin: '*' },
      post('http://anywhere.example'),
    );
    expect(res.statusCode).toBe(200);
  });
});
