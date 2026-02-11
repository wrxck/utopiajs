// ============================================================================
// @matthesketh/utopia-ai — MCP HTTP Handler
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MCPServer } from './server.js';
import type { JsonRpcRequest } from './types.js';

export interface MCPHandlerOptions {
  corsOrigin?: string;
}

/**
 * Create a Node.js HTTP handler for an MCP server.
 *
 * Supports:
 * - POST /       — JSON-RPC request/response
 * - GET  /sse    — Server-Sent Events transport (Streamable HTTP)
 * - POST /sse    — JSON-RPC over SSE
 *
 * ```ts
 * import http from 'node:http';
 * import { createMCPServer } from '@matthesketh/utopia-ai/mcp';
 * import { createMCPHandler } from '@matthesketh/utopia-ai/mcp';
 *
 * const mcp = createMCPServer({ name: 'my-app', tools: [...] });
 * const handler = createMCPHandler(mcp, { corsOrigin: 'https://example.com' });
 *
 * http.createServer(handler).listen(3001);
 * // or use as middleware: app.use('/mcp', handler);
 * ```
 */
export function createMCPHandler(
  server: MCPServer,
  options?: MCPHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const corsOrigin = options?.corsOrigin ?? '*';

  return async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // SSE endpoint for Streamable HTTP transport
    if (url.pathname.endsWith('/sse') && req.method === 'GET') {
      handleSSE(server, req, res);
      return;
    }

    // JSON-RPC over POST
    if (req.method === 'POST') {
      await handlePost(server, req, res);
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
  };
}

async function handlePost(
  server: MCPServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readBody(req);
    const request: JsonRpcRequest = JSON.parse(body);

    const response = await server.handleRequest(request);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (err: unknown) {
    // Only expose error details for JSON parse errors (SyntaxError).
    // All other errors get a generic message to prevent information leakage.
    const data = err instanceof SyntaxError ? err.message : 'Invalid request';

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
          data,
        },
      }),
    );
  }
}

function handleSSE(server: MCPServer, _req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send endpoint event so client knows where to POST
  const endpointUrl = './';
  res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

  // Keep connection alive with periodic pings
  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 30_000);

  _req.on('close', () => {
    clearInterval(keepAlive);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
