// ============================================================================
// @matthesketh/utopia-ai — MCP HTTP Handler
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MCPServer } from './server';
import type { JsonRpcRequest } from './types';

export interface MCPHandlerOptions {
  corsOrigin?: string;
  /**
   * allow-list of permitted `Origin` header values. when set, any request
   * carrying an `Origin` not in the list is rejected with 403. this is the
   * primary defence against dns-rebinding attacks on a locally-bound server.
   */
  allowedOrigins?: string[];
  /**
   * authorisation gate run before any request is dispatched to the server.
   * return false (or throw) to reject with 401. an mcp server exposes tool
   * execution, so it must not be reachable on a network without an authz
   * check — there is intentionally no default-allow for remote callers.
   */
  authorize?: (req: IncomingMessage) => boolean | Promise<boolean>;
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
  const corsOrigin = options?.corsOrigin;
  const allowedOrigins = options?.allowedOrigins;
  const authorize = options?.authorize;

  return async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers (only set if explicitly configured)
    if (corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // reject cross-origin requests early (dns-rebinding defence). only enforced
    // when an allow-list is configured so existing same-origin setups are
    // unaffected.
    const origin = req.headers.origin;
    if (allowedOrigins && origin !== undefined && !allowedOrigins.includes(origin)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // authorisation gate — runs before any tool/resource/prompt dispatch.
    if (authorize) {
      let allowed = false;
      try {
        allowed = await authorize(req);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Unauthorized' },
          }),
        );
        return;
      }
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // sse endpoint for streamable http transport
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
    const errObj = err as { statusCode?: number; message?: string };

    // Handle oversized payloads
    if (errObj.statusCode === 413) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Payload too large' },
        }),
      );
      return;
    }

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

const DEFAULT_MAX_BODY_SIZE = 1024 * 1024; // 1 MB

function readBody(req: IncomingMessage, maxSize: number = DEFAULT_MAX_BODY_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.removeAllListeners('data');
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
