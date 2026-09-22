// ============================================================================
// @matthesketh/utopia-server — createHandler / api-handler tests
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { buildApiRoutes, handleApiRequest } from './api-handler';
import type { HandlerOptions } from './handler';
import { createHandler } from './handler';
import { serializeHead } from './render-to-string';

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
  bytes: Buffer;
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
    const captured: CapturedResponse = {
      statusCode: 0,
      headers: {},
      body: '',
      bytes: Buffer.alloc(0),
    };
    const chunks: Buffer[] = [];
    // a real writable, so a streamed body can be piped to it as to a socket.
    const res = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    Object.assign(res, {
      writeHead(status: number, headers?: Record<string, string | string[]>) {
        captured.statusCode = status;
        if (headers) Object.assign(captured.headers, headers);
        return res;
      },
    });
    res.on('finish', () => {
      captured.bytes = Buffer.concat(chunks);
      captured.body = captured.bytes.toString('utf8');
      resolve(captured);
    });
    createHandler(options)(req, res as unknown as ServerResponse);
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

describe('createHandler — API responses reach the client intact', () => {
  const apiOptions = (
    manifest: Record<string, () => Promise<Record<string, unknown>>>,
  ): HandlerOptions => ({
    template,
    render: async () => ({ html: 'page', css: '' }),
    apiRoutes: manifest,
  });

  it('keeps every Set-Cookie header', async () => {
    const manifest = {
      '/src/routes/api/login/+server.ts': () =>
        Promise.resolve({
          POST: () => {
            const headers = new Headers();
            headers.append('Set-Cookie', 'session=abc; HttpOnly');
            headers.append('Set-Cookie', 'csrf=xyz');
            return new Response(null, { status: 204, headers });
          },
        }),
    };
    const res = await runHandler(apiOptions(manifest), makeReq('/api/login', 'POST', ''));
    expect(res.statusCode).toBe(204);
    expect(res.headers['set-cookie']).toEqual(['session=abc; HttpOnly', 'csrf=xyz']);
  });

  it('sends a binary body byte for byte', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xc3]);
    const manifest = {
      '/src/routes/api/image/+server.ts': () =>
        Promise.resolve({
          GET: () => new Response(png, { headers: { 'Content-Type': 'image/png' } }),
        }),
    };
    const res = await runHandler(apiOptions(manifest), makeReq('/api/image'));
    expect([...res.bytes]).toEqual([...png]);
  });

  it('streams a body instead of buffering it until it ends', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\n\n'));
        await gate;
        controller.enqueue(new TextEncoder().encode('data: second\n\n'));
        controller.close();
      },
    });
    const manifest = {
      '/src/routes/api/events/+server.ts': () =>
        Promise.resolve({ GET: () => new Response(stream) }),
    };

    const firstChunk = new Promise<string>((resolve) => {
      const res = new Writable({
        write(chunk: Buffer, _enc, cb) {
          resolve(Buffer.from(chunk).toString());
          cb();
        },
      });
      Object.assign(res, { writeHead: () => res });
      createHandler(apiOptions(manifest))(makeReq('/api/events'), res as unknown as ServerResponse);
    });
    // the first event arrives while the stream is still open.
    expect(await firstChunk).toBe('data: first\n\n');
    release();
  });

  it('sends no body for HEAD', async () => {
    const manifest = {
      '/src/routes/api/head/+server.ts': () =>
        Promise.resolve({ HEAD: () => new Response('ignored') }),
    };
    const res = await runHandler(apiOptions(manifest), makeReq('/api/head', 'HEAD'));
    expect(res.body).toBe('');
  });

  it('answers HEAD from the GET handler when there is no HEAD export', async () => {
    const manifest = {
      '/src/routes/api/doc/+server.ts': () =>
        Promise.resolve({ GET: () => new Response('body', { headers: { 'X-Doc': '1' } }) }),
    };
    const res = await runHandler(apiOptions(manifest), makeReq('/api/doc', 'HEAD'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-doc']).toBe('1');
    expect(res.body).toBe('');
  });

  it('prefers a static API route over a dynamic sibling', async () => {
    const manifest = {
      '/src/routes/api/[id]/+server.ts': () =>
        Promise.resolve({ GET: () => new Response('by id') }),
      '/src/routes/api/stats/+server.ts': () =>
        Promise.resolve({ GET: () => new Response('stats') }),
    };
    const res = await runHandler(apiOptions(manifest), makeReq('/api/stats'));
    expect(res.body).toBe('stats');
    const byId = await runHandler(apiOptions(manifest), makeReq('/api/42'));
    expect(byId.body).toBe('by id');
  });
});
