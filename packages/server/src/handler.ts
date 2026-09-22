// ============================================================================
// @matthesketh/utopia-server — HTTP request handler
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { buildApiRoutes, handleApiRequest } from '@/api-handler';
import { escapeAttr, escapeStyleContent } from '@/html-utils';
import { serializeHead } from '@/render-to-string';
import type { HeadConfig } from '@/ssr-runtime';

export interface HandlerOptions {
  /** The HTML template with <!--ssr-outlet--> and <!--ssr-head--> markers. */
  template: string;
  /** Render function that produces HTML + CSS + head entries for a given URL. */
  render: (url: string) => Promise<{ html: string; css: string; head?: HeadConfig[] }>;
  /** optional per-request nonce generator for CSP. */
  nonce?: () => string;
  /** optional glob manifest of +server.ts API route modules. */
  apiRoutes?: Record<string, () => Promise<Record<string, unknown>>>;
  /**
   * emit baseline security response headers (x-content-type-options,
   * referrer-policy, x-frame-options) on the html response. defaults to true.
   */
  securityHeaders?: boolean;
  /**
   * content-security-policy for the html response. a string is sent verbatim;
   * a function receives the per-request nonce so the policy can reference it
   * (e.g. `(n) => \`script-src 'nonce-${n}'\``). omitted → no csp header is sent,
   * so a bare `nonce` generator has no effect until a policy is supplied.
   */
  csp?: string | ((nonce: string | undefined) => string);
}

// RequestInit derived from the Request constructor (avoids relying on the
// global type name), plus the fetch-spec `duplex` member required for
// stream bodies, which the built-in lib typings do not yet declare.
type FetchRequestInit = NonNullable<ConstructorParameters<typeof Request>[1]> & {
  duplex?: 'half';
};

/**
 * Convert a Node.js IncomingMessage into a fetch Request, forwarding the
 * incoming headers and (for methods that can carry one) the request body so
 * API route handlers can read `request.headers` / `await request.json()` etc.
 */
function toFetchRequest(req: IncomingMessage, url: URL, method: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(name, v);
    } else {
      headers.set(name, value);
    }
  }

  const canHaveBody = method !== 'GET' && method !== 'HEAD';
  const init: FetchRequestInit = { method, headers };
  if (canHaveBody) {
    init.body = Readable.toWeb(req) as unknown as FetchRequestInit['body'];
    // required by fetch when the body is a stream.
    init.duplex = 'half';
  }
  return new Request(url.href, init);
}

/**
 * Write a fetch `Response` to a Node `ServerResponse`.
 *
 * - Every `Set-Cookie` is kept. `Object.fromEntries(headers.entries())` kept
 *   only the last, so a route setting a session and a CSRF cookie lost one.
 * - The body is streamed as bytes. Reading it with `text()` decoded binary
 *   bodies (files, images) as UTF-8 and corrupted them, and buffered a
 *   server-sent-events stream until it ended — so it never streamed.
 * - A HEAD response carries no body.
 */
async function sendResponse(
  res: ServerResponse,
  response: Response,
  method: string,
): Promise<void> {
  // guard against a handler returning a status outside the http range, which
  // would otherwise throw ERR_HTTP_INVALID_STATUS_CODE.
  const status =
    Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      ? response.status
      : 500;

  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') headers[name] = value;
  }
  const cookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  res.writeHead(status, headers);

  if (method === 'HEAD') {
    res.end();
    return;
  }
  if (!response.body) {
    // a body-less Response, or a Response-like object that only offers text().
    const text = typeof response.text === 'function' ? await response.text() : '';
    res.end(text);
    return;
  }

  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  await new Promise<void>((resolve, reject) => {
    body.on('error', reject);
    res.on('error', reject);
    // the client disconnected mid-stream: stop reading the handler's body.
    res.on('close', () => {
      if (!res.writableFinished) body.destroy();
      resolve();
    });
    body.pipe(res);
  });
}

/**
 * Create a Node.js HTTP request handler for SSR.
 *
 * The handler renders the component for the incoming URL and injects the
 * result into the HTML template at the marker positions:
 *
 * - `<!--ssr-head-->` — replaced with `<style>` tags for collected CSS
 * - `<!--ssr-outlet-->` — replaced with the rendered HTML
 *
 * @param options - Handler configuration
 * @returns An `(req, res) => void` function suitable for Node's `http.createServer`
 *          or as Express middleware.
 */
export function createHandler(
  options: HandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const {
    template,
    render,
    nonce: nonceGenerator,
    apiRoutes: apiManifest,
    securityHeaders = true,
    csp,
  } = options;
  const compiledApiRoutes = apiManifest ? buildApiRoutes(apiManifest) : [];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    // Check API routes first.
    if (compiledApiRoutes.length > 0) {
      try {
        const parsedUrl = new URL(url, `http://${req.headers.host ?? 'localhost'}`);
        const method = (req.method ?? 'GET').toUpperCase();
        const apiRequest = toFetchRequest(req, parsedUrl, method);
        const apiResponse = await handleApiRequest(
          parsedUrl,
          method,
          apiRequest,
          compiledApiRoutes,
        );

        if (apiResponse) {
          await sendResponse(res, apiResponse, method);
          return;
        }
      } catch (err) {
        console.error('[utopia] API route error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }
    }

    try {
      const result = await render(url);
      const { html, css, head } = result;

      const requestNonce = nonceGenerator ? nonceGenerator() : undefined;

      // Build the head injection (scoped styles + head entries).
      const headParts: string[] = [];
      if (css) {
        // escape so a nonce value can never break out of the attribute.
        const nonceAttr = requestNonce ? ` nonce="${escapeAttr(requestNonce)}"` : '';
        headParts.push(`<style${nonceAttr}>${escapeStyleContent(css)}</style>`);
      }
      if (head && head.length > 0) {
        headParts.push(serializeHead(head, requestNonce));
      }
      const headInject = headParts.join('\n');

      // inject into template. function replacers are used so `$`-sequences in
      // the rendered html/head (e.g. `$&`, `$'`, `$1`) are inserted literally
      // rather than being interpreted as replacement patterns by the replacer.
      const page = template
        .replace('<!--ssr-head-->', () => headInject)
        .replace('<!--ssr-outlet-->', () => html);

      const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' };
      if (securityHeaders) {
        headers['X-Content-Type-Options'] = 'nosniff';
        headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
        headers['X-Frame-Options'] = 'SAMEORIGIN';
      }
      if (csp !== undefined) {
        headers['Content-Security-Policy'] = typeof csp === 'function' ? csp(requestNonce) : csp;
      }

      res.writeHead(200, headers);
      res.end(page);
    } catch (err) {
      console.error('[utopia] SSR render error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  };
}
