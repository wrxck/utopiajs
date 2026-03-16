// ============================================================================
// @matthesketh/utopia-server — HTTP request handler
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { STYLE_CLOSE_RE } from './render-to-stream.js';
import type { HeadConfig } from './ssr-runtime.js';
import { serializeHead } from './render-to-string.js';
import { buildApiRoutes, handleApiRequest } from './api-handler.js';
import type { RequestEvent, RequestHandler } from './api-handler.js';

function escapeStyleContent(css: string): string {
  return css.replace(STYLE_CLOSE_RE, '<\\/style');
}

export interface HandlerOptions {
  /** The HTML template with <!--ssr-outlet--> and <!--ssr-head--> markers. */
  template: string;
  /** Render function that produces HTML + CSS + head entries for a given URL. */
  render: (url: string) => Promise<{ html: string; css: string; head?: HeadConfig[] }>;
  /** Optional per-request nonce generator for CSP. */
  nonce?: () => string;
  /** Optional glob manifest of +server.ts API route modules. */
  apiRoutes?: Record<string, () => Promise<Record<string, unknown>>>;
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
  const { template, render, nonce: nonceGenerator, apiRoutes: apiManifest } = options;
  const compiledApiRoutes = apiManifest ? buildApiRoutes(apiManifest) : [];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    // Check API routes first.
    if (compiledApiRoutes.length > 0) {
      try {
        const parsedUrl = new URL(url, `http://${req.headers.host ?? 'localhost'}`);
        const method = (req.method ?? 'GET').toUpperCase();
        const apiRequest = new Request(parsedUrl.href, { method });
        const apiResponse = await handleApiRequest(
          parsedUrl,
          method,
          apiRequest,
          compiledApiRoutes,
        );

        if (apiResponse) {
          res.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers.entries()));
          const body = await apiResponse.text();
          res.end(body);
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
        const nonceAttr = requestNonce ? ` nonce="${requestNonce}"` : '';
        headParts.push(`<style${nonceAttr}>${escapeStyleContent(css)}</style>`);
      }
      if (head && head.length > 0) {
        headParts.push(serializeHead(head, requestNonce));
      }
      const headInject = headParts.join('\n');

      // Inject into template.
      const page = template
        .replace('<!--ssr-head-->', headInject)
        .replace('<!--ssr-outlet-->', html);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page);
    } catch (err) {
      console.error('[utopia] SSR render error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  };
}
