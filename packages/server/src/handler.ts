// ============================================================================
// @utopia/server — HTTP request handler
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface HandlerOptions {
  /** The HTML template with <!--ssr-outlet--> and <!--ssr-head--> markers. */
  template: string;
  /** Render function that produces HTML + CSS for a given URL. */
  render: (url: string) => Promise<{ html: string; css: string }>;
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
  const { template, render } = options;

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    try {
      const { html, css } = await render(url);

      // Build the head injection (scoped styles).
      const headInject = css ? `<style>${css}</style>` : '';

      // Inject into template.
      let page = template;
      page = page.replace('<!--ssr-head-->', headInject);
      page = page.replace('<!--ssr-outlet-->', html);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page);
    } catch (err) {
      console.error('[utopia] SSR render error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  };
}
