// ============================================================================
// @matthesketh/utopia-ai — MCP HTTP Handler
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { MCPServer } from '@/mcp/server';
import type { JsonRpcRequest } from '@/mcp/types';

export interface MCPHandlerOptions {
  corsOrigin?: string;
  /**
   * allow-list of permitted `Origin` header values. any request carrying an
   * `Origin` not in the list is rejected with 403 — the defence against
   * dns-rebinding attacks the MCP transport spec requires.
   *
   * when omitted, the handler still validates `Origin`: it accepts loopback
   * origins (localhost, 127.0.0.1, [::1]) and `corsOrigin` when that names a
   * single origin. `corsOrigin: '*'` turns the check off. a request with no
   * `Origin` header (a server-side client) is never affected.
   */
  allowedOrigins?: string[];
  /**
   * authorisation gate run before any request is dispatched to the server.
   * return false (or throw) to reject with 401. an mcp server exposes tool
   * execution: without this, every caller that can reach it can run its
   * tools, so do not expose it on a network without one. (the handler warns
   * once when it is created without an authorize function.)
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
  const authorize = options?.authorize;
  // the origins a browser request may come from. with no explicit list,
  // loopback plus a single configured cors origin; a wildcard cors origin
  // is an explicit opt-out.
  const isAllowedOrigin: (origin: string) => boolean = options?.allowedOrigins
    ? (origin) => options.allowedOrigins!.includes(origin)
    : corsOrigin === '*'
      ? () => true
      : (origin) => origin === corsOrigin || isLoopbackOrigin(origin);

  if (!authorize && !warnedNoAuthorize) {
    warnedNoAuthorize = true;
    console.warn(
      '[utopia-ai] createMCPHandler without an authorize option: every caller that can reach this server can run its tools.',
    );
  }

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

    // reject cross-origin browser requests early (dns-rebinding defence). it
    // used to run only when an allow-list was configured, so a server bound to
    // localhost answered any web page that rebound a hostname to 127.0.0.1.
    const origin = req.headers.origin;
    if (origin !== undefined && !isAllowedOrigin(origin)) {
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
        // the auth check threw — treat as not allowed (allowed stays false).
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

    // a malformed Host header must not crash routing (the URL constructor
    // throws on invalid base URLs) — fall back to the raw path in that case.
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
    } catch {
      pathname = (req.url ?? '/').split('?')[0];
    }

    // sse endpoint for streamable http transport
    if (pathname.endsWith('/sse') && req.method === 'GET') {
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

let warnedNoAuthorize = false;

/** An http(s) origin on the loopback interface. */
function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname.endsWith('.localhost')
  );
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
