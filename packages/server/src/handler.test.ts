// ============================================================================
// @matthesketh/utopia-server — createHandler / api-handler tests
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHandler } from './handler';
import type { HandlerOptions } from './handler';
import { buildApiRoutes, handleApiRequest } from './api-handler';
import { serializeHead } from './render-to-string';

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function makeReq(
  url: string | undefined,
  method = 'GET',
  body?: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const stream = body === undefined ? Readable.from([]) : Readable.from([Buffer.from(body)]);
  return Object.assign(stream, {
    url,
    method,
    headers: { host: 'localhost', ...headers },
  }) as unknown as IncomingMessage;
}

function runHandler(options: HandlerOptions, req: IncomingMessage): Promise<CapturedResponse> {
  return new Promise((resolve) => {
    const captured: CapturedResponse = { statusCode: 0, headers: {}, body: '' };
    const res = {
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
    createHandler(options)(req, res);
  });
}

const template = '<html><head><!--ssr-head--></head><body><!--ssr-outlet--></body></html>';

describe('createHandler — SSR page rendering', () => {
  it('injects head entries via serializeHead', async () => {
    const res = await runHandler(
      {
        template,
        render: async () => ({
          html: '<div>hi</div>',
          css: '',
          head: [{ title: 'My Page', meta: [{ name: 'description', content: 'desc' }] }],
        }),
      },
      makeReq('/'),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>My Page</title>');
    expect(res.body).toContain('<meta name="description" content="desc">');
    expect(res.body).toContain('<div>hi</div>');
  });

  it('defaults to "/" when req.url is missing', async () => {
    const render = vi.fn(async () => ({ html: 'x', css: '' }));
    await runHandler({ template, render }, makeReq(undefined));
    expect(render).toHaveBeenCalledWith('/');
  });

  it('returns 500 when render throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await runHandler(
        {
          template,
          render: async () => {
            throw new Error('render exploded');
          },
        },
        makeReq('/'),
      );
      expect(res.statusCode).toBe(500);
      expect(res.body).toBe('Internal Server Error');
      expect(res.headers['Content-Type']).toBe('text/plain');
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('emits a nonce-less style tag when css is present without a nonce generator', async () => {
    const res = await runHandler(
      { template, render: async () => ({ html: 'x', css: 'p { margin: 0; }' }) },
      makeReq('/'),
    );
    expect(res.body).toContain('<style>p { margin: 0; }</style>');
  });

  it('sends a string CSP header verbatim', async () => {
    const res = await runHandler(
      {
        template,
        render: async () => ({ html: 'x', css: '' }),
        csp: "default-src 'self'",
      },
      makeReq('/'),
    );
    expect(res.headers['Content-Security-Policy']).toBe("default-src 'self'");
  });

  it('escapes the nonce when injecting it into the style tag', async () => {
    const res = await runHandler(
      {
        template,
        render: async () => ({ html: 'x', css: 'body { color: red; }' }),
        nonce: () => 'abc" onload="alert(1)',
      },
      makeReq('/'),
    );
    // A hostile/buggy nonce generator must not be able to break out of the
    // nonce attribute value.
    expect(res.body).not.toContain('nonce="abc" onload=');
    expect(res.body).toContain('nonce="abc&quot; onload=&quot;alert(1)"');
  });
});

describe('createHandler — API routes', () => {
  const apiOptions = (
    manifest: Record<string, () => Promise<Record<string, unknown>>>,
  ): HandlerOptions => ({
    template,
    render: async () => ({ html: 'page', css: '' }),
    apiRoutes: manifest,
  });

  it('forwards the request body to API route handlers', async () => {
    const manifest = {
      '/src/routes/api/echo/+server.ts': () =>
        Promise.resolve({
          POST: async ({ request }: { request: Request }) =>
            new Response(await request.text(), { status: 201 }),
        }),
    };
    const res = await runHandler(
      apiOptions(manifest),
      makeReq('/api/echo', 'POST', '{"name":"alice"}', { 'content-type': 'application/json' }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.body).toBe('{"name":"alice"}');
  });

  it('forwards request headers to API route handlers', async () => {
    const manifest = {
      '/src/routes/api/headers/+server.ts': () =>
        Promise.resolve({
          GET: ({ request }: { request: Request }) =>
            new Response(request.headers.get('x-custom') ?? 'missing'),
        }),
    };
    const res = await runHandler(
      apiOptions(manifest),
      makeReq('/api/headers', 'GET', undefined, { 'x-custom': 'forwarded-value' }),
    );
    expect(res.body).toBe('forwarded-value');
  });

  it('handles requests without host, method or defined header values', async () => {
    const manifest = {
      '/src/routes/api/loose/+server.ts': () =>
        Promise.resolve({ GET: () => new Response('loose-ok') }),
    };
    const req = makeReq('/api/loose', 'GET');
    (req as unknown as { method?: string }).method = undefined;
    req.headers.host = undefined;
    (req.headers as Record<string, unknown>)['x-undef'] = undefined;
    const res = await runHandler(apiOptions(manifest), req);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('loose-ok');
  });

  it('forwards multi-valued request headers', async () => {
    const manifest = {
      '/src/routes/api/multi/+server.ts': () =>
        Promise.resolve({
          GET: ({ request }: { request: Request }) =>
            new Response(request.headers.get('x-multi') ?? 'missing'),
        }),
    };
    const req = makeReq('/api/multi');
    (req.headers as Record<string, unknown>)['x-multi'] = ['one', 'two'];
    const res = await runHandler(apiOptions(manifest), req);
    expect(res.body).toBe('one, two');
  });

  it('clamps an out-of-range status from a duck-typed response object', async () => {
    const manifest = {
      '/src/routes/api/fake/+server.ts': () =>
        Promise.resolve({
          // Not a real Response — simulates a handler returning a Response-like
          // object with a status Node would reject.
          GET: () => ({ status: 999, headers: new Headers(), text: async () => 'body' }),
        }),
    };
    const res = await runHandler(apiOptions(manifest), makeReq('/api/fake'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('body');
  });

  it('clamps a non-integer status from a duck-typed response object', async () => {
    const manifest = {
      '/src/routes/api/nan/+server.ts': () =>
        Promise.resolve({
          GET: () => ({ status: Number.NaN, headers: new Headers(), text: async () => 'nan' }),
        }),
    };
    const res = await runHandler(apiOptions(manifest), makeReq('/api/nan'));
    expect(res.statusCode).toBe(500);
  });

  it('forwards API response headers to the client', async () => {
    const manifest = {
      '/src/routes/api/json/+server.ts': () =>
        Promise.resolve({
          GET: () =>
            new Response('{"ok":true}', {
              headers: { 'Content-Type': 'application/json', 'X-Api': 'yes' },
            }),
        }),
    };
    const res = await runHandler(apiOptions(manifest), makeReq('/api/json'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['x-api']).toBe('yes');
    expect(res.body).toBe('{"ok":true}');
  });

  it('returns 500 when the API module loader rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const manifest = {
        '/src/routes/api/broken/+server.ts': () => Promise.reject(new Error('module load failed')),
      };
      const res = await runHandler(apiOptions(manifest), makeReq('/api/broken'));
      expect(res.statusCode).toBe(500);
      expect(res.body).toBe('Internal Server Error');
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('falls through to SSR rendering when no API route matches', async () => {
    const manifest = {
      '/src/routes/api/other/+server.ts': () => Promise.resolve({ GET: () => new Response('no') }),
    };
    const res = await runHandler(apiOptions(manifest), makeReq('/about'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('page');
  });
});

describe('serializeHead — meta property entries', () => {
  it('serializes open-graph style property meta tags', () => {
    const html = serializeHead([
      { meta: [{ property: 'og:title', content: 'OG Title' }] },
      { meta: [{ name: 'author', property: 'article:author', content: 'Matt' }] },
    ]);
    expect(html).toContain('<meta property="og:title" content="OG Title">');
    expect(html).toContain('<meta name="author" property="article:author" content="Matt">');
  });
});

describe('handleApiRequest — path normalization and method dispatch', () => {
  it('matches routes when the URL has a trailing slash', async () => {
    const routes = buildApiRoutes({
      '/src/routes/api/data/+server.ts': () => Promise.resolve({ GET: () => new Response('data') }),
    });
    const url = new URL('http://localhost/api/data/');
    const res = await handleApiRequest(url, 'GET', new Request(url.href), routes);
    expect(res).not.toBeNull();
    expect(await res!.text()).toBe('data');
  });

  it('lists exported methods in the Allow header on 405', async () => {
    const routes = buildApiRoutes({
      '/src/routes/api/data/+server.ts': () =>
        Promise.resolve({
          GET: () => new Response('x'),
          POST: () => new Response('y'),
          helper: () => 'not a method',
        }),
    });
    const url = new URL('http://localhost/api/data');
    const res = await handleApiRequest(url, 'DELETE', new Request(url.href), routes);
    expect(res!.status).toBe(405);
    expect(res!.headers.get('Allow')).toBe('GET, POST');
  });

  it('ignores manifest entries that are not +server files', () => {
    const routes = buildApiRoutes({
      '/src/routes/api/+page.utopia': () => Promise.resolve({}),
      '/src/routes/api/data/+server.ts': () => Promise.resolve({ GET: () => new Response('x') }),
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/api/data');
  });
});
