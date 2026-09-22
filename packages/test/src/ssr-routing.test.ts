// @vitest-environment node
/**
 * Server rendering of a routed app.
 *
 * `RouterView` used to call `document` directly, so any server render of an
 * app with a router threw `document is not defined` — including the app the
 * CLI scaffolds when SSR is selected. The router now builds through the
 * runtime, which a server build swaps for the SSR runtime; this file performs
 * the same swap for the router's own import.
 */

import { compileTemplate } from '@matthesketh/utopia-compiler';
import { signal } from '@matthesketh/utopia-core';
import { withRoute } from '@matthesketh/utopia-router';
import { renderToString } from '@matthesketh/utopia-server';
import * as ssrRuntime from '@matthesketh/utopia-server/ssr-runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  ABOUT,
  APP,
  HOME,
  HOME_HTML,
  LAYOUT,
  loadComponent,
  type ModuleMap,
} from './fixtures/routing';

vi.mock('@matthesketh/utopia-runtime', () => import('@matthesketh/utopia-server/ssr-runtime'));

async function modules(): Promise<ModuleMap> {
  return {
    '@matthesketh/utopia-runtime': ssrRuntime as unknown as Record<string, unknown>,
    '@matthesketh/utopia-router': (await import('@matthesketh/utopia-router')) as unknown as Record<
      string,
      unknown
    >,
    'fixture-state': { name: signal('home'), flag: signal(true) },
  };
}

async function routes() {
  const mods = await modules();
  const Layout = loadComponent(LAYOUT, mods);
  return {
    App: loadComponent(APP, mods),
    table: [
      {
        path: '/',
        component: async () => ({ default: loadComponent(HOME, mods) }),
        layout: async () => ({ default: Layout }),
      },
      { path: '/about', component: async () => ({ default: loadComponent(ABOUT, mods) }) },
    ],
  };
}

describe('server rendering with a router', () => {
  it('has no DOM to fall back on', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
  });

  it('renders the page for the url inside its layout', async () => {
    const { App, table } = await routes();
    const { html } = await withRoute(table, '/', () =>
      renderToString(App as Parameters<typeof renderToString>[0]),
    );
    expect(html).toBe(HOME_HTML);
  });

  it('keeps concurrent requests on their own routes', async () => {
    const { App, table } = await routes();
    const render = (url: string) =>
      withRoute(table, url, () => renderToString(App as Parameters<typeof renderToString>[0]).html);
    const [home, about, homeAgain] = await Promise.all([
      render('/'),
      render('/about'),
      render('/'),
    ]);
    expect(home).toBe(HOME_HTML);
    expect(homeAgain).toBe(HOME_HTML);
    expect(about).toContain('<main><p>About</p></main>');
  });

  it('renders the not-found view for an unknown url', async () => {
    const { App, table } = await routes();
    const { html } = await withRoute(table, '/nope', () =>
      renderToString(App as Parameters<typeof renderToString>[0]),
    );
    expect(html).toContain('<div data-utopia-not-found>Page not found</div>');
  });
});

describe('slots on a server', () => {
  // the compiled default slot tested `_ctx.children instanceof Node`, and a
  // server has no Node global: every <slot /> rendered without content threw.
  function serverRender(template: string): string {
    const { code } = compileTemplate(template);
    const body = code.replace(/^import[^\n]*\n/, '');
    const helpers = ssrRuntime as unknown as Record<string, unknown>;
    const names = Object.keys(helpers);
    const render = new Function(...names, `${body}\nreturn __render`)(
      ...names.map((n) => helpers[n]),
    );
    return renderToString({ render } as Parameters<typeof renderToString>[0]).html;
  }

  it('renders an unfilled default slot', () => {
    expect(serverRender('<div><slot /></div>')).toBe('<div><!--slot--></div>');
  });

  it('renders slot fallback content', () => {
    expect(serverRender('<div><slot><p>none yet</p></slot></div>')).toBe(
      '<div><p>none yet</p></div>',
    );
  });
});
