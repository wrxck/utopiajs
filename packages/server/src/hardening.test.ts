// regression tests for the v0.8 server hardening pass: ssr attribute safety,
// the ssr-injection $-pattern fix, security headers, status clamping, and
// api-route method/decoding robustness.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, it, expect } from 'vitest';

import { setAttr, createElement } from './ssr-runtime';
import { createHandler } from './handler';
import type { HandlerOptions } from './handler';
import { buildApiRoutes, handleApiRequest } from './api-handler';

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function runHandler(
  options: HandlerOptions,
  url: string,
  method = 'GET',
): Promise<CapturedResponse> {
  const handler = createHandler(options);
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
    const req = { url, method, headers: { host: 'localhost' } } as unknown as IncomingMessage;
    handler(req, res);
  });
}

describe('ssr setAttr URL/event-handler guards', () => {
  it('drops javascript: hrefs so they never reach the serialiser', () => {
    const el = createElement('a');
    setAttr(el, 'href', 'javascript:alert(1)');
    expect(el.attrs.href).toBeUndefined();
  });

  it('keeps safe urls and data:image on media attributes', () => {
    const a = createElement('a');
    setAttr(a, 'href', 'https://ok.test');
    expect(a.attrs.href).toBe('https://ok.test');
    const img = createElement('img');
    setAttr(img, 'src', 'data:image/png;base64,iVBORw0KGgo=');
    expect(img.attrs.src).toContain('data:image/png');
  });

  it('refuses on* event-handler attributes', () => {
    const el = createElement('div');
    setAttr(el, 'onclick', 'alert(1)');
    expect(el.attrs.onclick).toBeUndefined();
  });
});

describe('ssr injection does not interpret $-replacement patterns', () => {
  const template = '<head><!--ssr-head--></head><body><!--ssr-outlet--></body>';

  it('inserts rendered html containing $-sequences literally', async () => {
    const res = await runHandler(
      {
        template,
        render: async () => ({ html: "A $` B $' C $& D $1 E", css: '', head: [] }),
      },
      '/',
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("A $` B $' C $& D $1 E");
    // the <body> wrapper must appear exactly once (no $`/$' duplication).
    expect(res.body.match(/<body>/g)?.length).toBe(1);
  });
});

describe('security headers and opt-in CSP', () => {
  const template = '<head><!--ssr-head--></head><body><!--ssr-outlet--></body>';
  const render = async () => ({ html: 'ok', css: '', head: [] });

  it('sends baseline security headers by default', async () => {
    const res = await runHandler({ template, render }, '/');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(res.headers['Content-Security-Policy']).toBeUndefined();
  });

  it('emits a CSP referencing the per-request nonce when configured', async () => {
    const res = await runHandler(
      { template, render, nonce: () => 'testnonce', csp: (n) => `script-src 'nonce-${n}'` },
      '/',
    );
    expect(res.headers['Content-Security-Policy']).toContain("'nonce-testnonce'");
  });

  it('omits security headers when disabled', async () => {
    const res = await runHandler({ template, render, securityHeaders: false }, '/');
    expect(res.headers['X-Content-Type-Options']).toBeUndefined();
  });
});

describe('api route status, method and decode robustness', () => {
  it('clamps an out-of-range handler status instead of crashing', async () => {
    const apiRoutes = {
      '/src/routes/api/boom/+server.ts': () =>
        Promise.resolve({ GET: () => new Response('x', { status: 999 }) }),
    };
    const res = await runHandler(
      {
        template: '<!--ssr-outlet-->',
        render: async () => ({ html: '', css: '', head: [] }),
        apiRoutes,
      },
      '/api/boom',
    );
    expect(res.statusCode).toBe(500);
  });

  it('does not dispatch to inherited prototype keys as methods', async () => {
    const manifest = {
      '/src/routes/api/data/+server.ts': () => Promise.resolve({ GET: () => new Response('ok') }),
    };
    const routes = buildApiRoutes(manifest);
    const url = new URL('http://localhost/api/data');
    for (const method of ['constructor', 'toString', '__proto__']) {
      const res = await handleApiRequest(url, method, new Request(url.href), routes);
      expect(res!.status).toBe(405);
    }
  });

  it('returns 400 (not 500) for malformed percent-encoding in a param', async () => {
    const manifest = {
      '/src/routes/api/users/[id]/+server.ts': () =>
        Promise.resolve({ GET: () => new Response('ok') }),
    };
    const routes = buildApiRoutes(manifest);
    const url = new URL('http://localhost/api/users/%E0%A4');
    const res = await handleApiRequest(url, 'GET', new Request(url.href), routes);
    expect(res!.status).toBe(400);
  });
});
