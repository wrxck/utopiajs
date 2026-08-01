// ============================================================================
// @matthesketh/utopia-router — Component (RouterView / Link / preload) tests
// ============================================================================
//
// Runs in the default jsdom environment. Tests cover:
//   1. createRouterView initial render (preloaded, async, unmatched)
//   2. Navigation swaps, stale-load invalidation, 404 rendering
//   3. Error boundaries (error component, failing error component, fallback)
//   4. renderComponent variants (function/string/render-object/invalid)
//   5. preloadRoute cache behavior
//   6. createLink (children, class, activeClass reactivity)
//
// ============================================================================

import { effect, signal } from '@matthesketh/utopia-core';
import { onDestroy } from '@matthesketh/utopia-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLink, createRouterView, preloadRoute } from './components';
import { createRouter, currentRoute, destroy, navigate } from './router';
import type { RouteConfig } from './types';

/** Flush pending microtasks and timers so fire-and-forget loads settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Build a module whose default component renders a tagged <div>. */
const pageModule = (name: string) => ({
  default: () => {
    const el = document.createElement('div');
    el.setAttribute('data-page', name);
    el.textContent = name;
    return el;
  },
});

/** Build a layout module that wraps `props.children` in a tagged <div>. */
const layoutModule = (name: string) => ({
  default: (props: Record<string, unknown>) => {
    const el = document.createElement('div');
    el.setAttribute('data-layout', name);
    el.appendChild(props.children as Node);
    return el;
  },
});

/** Views/links created via the tracked helpers, disposed after each test. */
const disposables: Node[] = [];

/** Create a RouterView node, registering it for post-test disposal. */
const renderView = (): HTMLElement => {
  const container = createRouterView().render() as HTMLElement;
  disposables.push(container);
  return container;
};

const disposeNode = (node: Node): void => {
  (node as unknown as { __dispose?: () => void }).__dispose?.();
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  // jsdom does not implement scrolling; keep navigation quiet.
  window.scrollTo = vi.fn();
});

afterEach(() => {
  for (const node of disposables) {
    disposeNode(node);
  }
  disposables.length = 0;
  destroy();
  vi.unstubAllGlobals();
});

// ============================================================================
// 1-2. createRouterView
// ============================================================================

describe('createRouterView', () => {
  it('renders the matched route asynchronously without preloading', async () => {
    const routes: RouteConfig[] = [
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
    ];
    createRouter(routes);

    const container = renderView();
    // Not preloaded — nothing yet.
    expect(container.querySelector('[data-page="home"]')).toBeNull();

    await flush();
    expect(container.querySelector('[data-page="home"]')).not.toBeNull();
  });

  it('renders synchronously from the preload cache, including the layout', async () => {
    const routes: RouteConfig[] = [
      {
        path: '/',
        component: () => Promise.resolve(pageModule('home')),
        layout: () => Promise.resolve(layoutModule('shell')),
      },
    ];
    createRouter(routes);
    await preloadRoute();

    const container = renderView();
    const layout = container.querySelector('[data-layout="shell"]');
    expect(layout).not.toBeNull();
    expect(layout!.querySelector('[data-page="home"]')).not.toBeNull();
  });

  it('renders the 404 node when the initial URL matches no route', () => {
    window.history.replaceState(null, '', '/ghost');
    createRouter([{ path: '/', component: () => Promise.resolve(pageModule('home')) }]);
    expect(currentRoute.peek()).toBeNull();

    const container = renderView();
    const notFound = container.querySelector('[data-utopia-not-found]');
    expect(notFound).not.toBeNull();
    expect(notFound!.textContent).toBe('Page not found');
  });

  it('swaps content when navigating between routes', async () => {
    const routes: RouteConfig[] = [
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
      { path: '/about', component: () => Promise.resolve(pageModule('about')) },
    ];
    createRouter(routes);
    const container = renderView();
    await flush();
    expect(container.querySelector('[data-page="home"]')).not.toBeNull();

    await navigate('/about');
    await flush();
    expect(container.querySelector('[data-page="about"]')).not.toBeNull();
    expect(container.querySelector('[data-page="home"]')).toBeNull();
  });

  it('shows the 404 node when navigating to an unmatched URL, replacing old content', async () => {
    const routes: RouteConfig[] = [
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
    ];
    createRouter(routes);
    const container = renderView();
    await flush();
    expect(container.querySelector('[data-page="home"]')).not.toBeNull();

    await navigate('/nowhere');
    await flush();
    expect(container.querySelector('[data-utopia-not-found]')).not.toBeNull();
    expect(container.querySelector('[data-page="home"]')).toBeNull();
  });

  it('discards a stale async load when a newer navigation wins', async () => {
    let resolveSlow!: (m: Record<string, unknown>) => void;
    const routes: RouteConfig[] = [
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
      { path: '/slow', component: () => new Promise((r) => (resolveSlow = r)) },
      { path: '/fast', component: () => Promise.resolve(pageModule('fast')) },
    ];
    createRouter(routes);
    const container = renderView();
    await flush();

    await navigate('/slow');
    await navigate('/fast');
    await flush();
    expect(container.querySelector('[data-page="fast"]')).not.toBeNull();

    // The slow route's module finally arrives — it must NOT replace /fast.
    resolveSlow(pageModule('slow'));
    await flush();
    expect(container.querySelector('[data-page="fast"]')).not.toBeNull();
    expect(container.querySelector('[data-page="slow"]')).toBeNull();
  });

  it('replaces the 404 node with page content when a route matches again', async () => {
    window.history.replaceState(null, '', '/ghost');
    createRouter([{ path: '/', component: () => Promise.resolve(pageModule('home')) }]);
    const container = renderView();
    expect(container.querySelector('[data-utopia-not-found]')).not.toBeNull();

    await navigate('/');
    await flush();
    expect(container.querySelector('[data-page="home"]')).not.toBeNull();
    expect(container.querySelector('[data-utopia-not-found]')).toBeNull();
  });

  it('uses preloaded modules on later navigation instead of re-importing', async () => {
    const homeImporter = vi.fn(() => Promise.resolve(pageModule('home')));
    const shellImporter = vi.fn(() => Promise.resolve(layoutModule('shell')));
    createRouter([
      { path: '/', component: homeImporter, layout: shellImporter },
      { path: '/about', component: () => Promise.resolve(pageModule('about')) },
    ]);

    const container = renderView();
    await flush(); // initial async render of '/' (cache empty)
    expect(homeImporter).toHaveBeenCalledTimes(1);

    // Re-populate the cache, then leave and return.
    await preloadRoute();
    expect(homeImporter).toHaveBeenCalledTimes(2);
    await navigate('/about');
    await flush();
    await navigate('/');
    await flush();

    // The return navigation consumed the cache — no third import.
    expect(homeImporter).toHaveBeenCalledTimes(2);
    const layout = container.querySelector('[data-layout="shell"]');
    expect(layout).not.toBeNull();
    expect(layout!.querySelector('[data-page="home"]')).not.toBeNull();
  });

  it('stops reacting to route changes after its __dispose is called', async () => {
    const aboutImporter = vi.fn(() => Promise.resolve(pageModule('about')));
    createRouter([
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
      { path: '/about', component: aboutImporter },
    ]);

    // Regression: RouterView subscribed an effect to currentRoute forever —
    // discarded views kept loading route modules on every navigation.
    const container = renderView();
    await flush();
    (container as unknown as { __dispose: () => void }).__dispose();

    await navigate('/about');
    await flush();
    expect(aboutImporter).not.toHaveBeenCalled();
  });

  it('wraps the page in its layout on the async load path', async () => {
    const routes: RouteConfig[] = [
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
      {
        path: '/docs',
        component: () => Promise.resolve(pageModule('docs')),
        layout: () => Promise.resolve(layoutModule('docs-shell')),
      },
    ];
    createRouter(routes);
    const container = renderView();

    await navigate('/docs');
    await flush();
    const layout = container.querySelector('[data-layout="docs-shell"]');
    expect(layout).not.toBeNull();
    expect(layout!.querySelector('[data-page="docs"]')).not.toBeNull();
  });
});

// ============================================================================
// 3. Error boundaries
// ============================================================================

describe('createRouterView error handling', () => {
  it('renders the route error component when the page module fails to load', async () => {
    const routes: RouteConfig[] = [
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
      {
        path: '/broken',
        component: () => Promise.reject(new Error('load failed')),
        error: () =>
          Promise.resolve({
            default: (props: Record<string, unknown>) => {
              const el = document.createElement('div');
              el.setAttribute('data-error-view', '');
              el.textContent = (props.error as Error).message;
              return el;
            },
          }),
      },
    ];
    createRouter(routes);
    const container = renderView();

    await navigate('/broken');
    await flush();
    const errorView = container.querySelector('[data-error-view]');
    expect(errorView).not.toBeNull();
    expect(errorView!.textContent).toBe('load failed');
  });

  it('supports an error module without a default export', async () => {
    const routes: RouteConfig[] = [
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
      {
        path: '/broken',
        component: () => Promise.reject(new Error('nope')),
        error: () =>
          Promise.resolve({
            render: () => {
              const el = document.createElement('div');
              el.setAttribute('data-error-view', 'module-level');
              return el;
            },
          }),
      },
    ];
    createRouter(routes);
    const container = renderView();

    await navigate('/broken');
    await flush();
    expect(container.querySelector('[data-error-view="module-level"]')).not.toBeNull();
  });

  it('falls back to the built-in error node when the error component also fails', async () => {
    const routes: RouteConfig[] = [
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
      {
        path: '/broken',
        component: () => Promise.reject(new Error('primary <script>alert(1)</script>')),
        error: () => Promise.reject(new Error('error component failed too')),
      },
    ];
    createRouter(routes);
    const container = renderView();

    await navigate('/broken');
    await flush();
    const fallback = container.querySelector('[data-utopia-error]') as HTMLElement;
    expect(fallback).not.toBeNull();
    // The message must be escaped — no live <script> element.
    expect(fallback.querySelector('script')).toBeNull();
    expect(fallback.innerHTML).toContain('&lt;script&gt;');
  });

  it('falls back to the built-in error node when the route has no error component', async () => {
    const routes: RouteConfig[] = [
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
      // Non-Error rejection exercises the String(error) branch.
      { path: '/broken', component: () => Promise.reject('plain failure') },
    ];
    createRouter(routes);
    const container = renderView();

    await navigate('/broken');
    await flush();
    const fallback = container.querySelector('[data-utopia-error]');
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toContain('plain failure');
  });
});

// ============================================================================
// 4. renderComponent variants
// ============================================================================

describe('renderComponent variants (via route modules)', () => {
  const mount = async (component: () => Promise<Record<string, unknown>>): Promise<HTMLElement> => {
    createRouter([
      { path: '/', component: () => Promise.resolve(pageModule('home')) },
      { path: '/variant', component },
    ]);
    const container = renderView();
    await navigate('/variant');
    await flush();
    return container;
  };

  it('renders a function component returning a string as a text node', async () => {
    const container = await mount(() => Promise.resolve({ default: () => 'plain text page' }));
    expect(container.textContent).toBe('plain text page');
  });

  it('renders a function component returning an object with a render method', async () => {
    const container = await mount(() =>
      Promise.resolve({
        default: () => ({
          render: () => {
            const el = document.createElement('span');
            el.setAttribute('data-page', 'lazy-render');
            return el;
          },
        }),
      }),
    );
    expect(container.querySelector('[data-page="lazy-render"]')).not.toBeNull();
  });

  it('renders an object component with a render(props) method', async () => {
    const container = await mount(() =>
      Promise.resolve({
        default: {
          render: (props: Record<string, unknown>) => {
            const el = document.createElement('div');
            el.setAttribute('data-page', 'object-component');
            el.textContent = (props.url as URL).pathname;
            return el;
          },
        },
      }),
    );
    const el = container.querySelector('[data-page="object-component"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('/variant');
  });

  it('uses the module itself when there is no default export', async () => {
    const container = await mount(() =>
      Promise.resolve({
        render: () => {
          const el = document.createElement('div');
          el.setAttribute('data-page', 'no-default');
          return el;
        },
      }),
    );
    expect(container.querySelector('[data-page="no-default"]')).not.toBeNull();
  });

  it('renders the error placeholder for a component returning an invalid value', async () => {
    const container = await mount(() => Promise.resolve({ default: () => 42 }));
    expect(container.textContent).toContain('[Component render error]');
  });
});

// ============================================================================
// 5. preloadRoute
// ============================================================================

describe('preloadRoute', () => {
  it('is a no-op when no route matches', async () => {
    window.history.replaceState(null, '', '/ghost');
    createRouter([{ path: '/', component: () => Promise.resolve(pageModule('home')) }]);
    await expect(preloadRoute()).resolves.toBeUndefined();
  });

  it('preloads a route without a layout', async () => {
    const importer = vi.fn(() => Promise.resolve(pageModule('home')));
    createRouter([{ path: '/', component: importer }]);
    await preloadRoute();
    expect(importer).toHaveBeenCalledTimes(1);

    const container = renderView();
    // Rendered synchronously from cache — the importer was not called again.
    expect(container.querySelector('[data-page="home"]')).not.toBeNull();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('reuses a preloaded layout-less module on later navigation', async () => {
    const homeImporter = vi.fn(() => Promise.resolve(pageModule('home')));
    createRouter([
      { path: '/', component: homeImporter },
      { path: '/about', component: () => Promise.resolve(pageModule('about')) },
    ]);

    const container = renderView();
    await flush();
    expect(homeImporter).toHaveBeenCalledTimes(1);

    await preloadRoute(); // caches '/' again
    await navigate('/about');
    await flush();
    await navigate('/');
    await flush();

    expect(homeImporter).toHaveBeenCalledTimes(2); // cache consumed, no 3rd import
    expect(container.querySelector('[data-page="home"]')).not.toBeNull();
  });
});

// ============================================================================
// 6. createLink
// ============================================================================

describe('createLink rendering', () => {
  const routes: RouteConfig[] = [
    { path: '/', component: () => Promise.resolve(pageModule('home')) },
    { path: '/about', component: () => Promise.resolve(pageModule('about')) },
    { path: '/about/:sub', component: () => Promise.resolve(pageModule('sub')) },
  ];

  it('renders an anchor with href, class, and string children', () => {
    createRouter(routes);
    const link = createLink({ href: '/about', children: 'About', class: 'nav-link' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/about');
    expect(link.className).toBe('nav-link');
    expect(link.textContent).toBe('About');
  });

  it('appends Node children', () => {
    createRouter(routes);
    const child = document.createElement('strong');
    child.textContent = 'Bold';
    const link = createLink({ href: '/', children: child });
    expect(link.querySelector('strong')).toBe(child);
  });

  it('toggles activeClass as the current route changes', async () => {
    createRouter(routes);
    const link = createLink({ href: '/about', children: 'About', activeClass: 'active' });
    disposables.push(link);

    // At '/', the link is inactive.
    expect(link.classList.contains('active')).toBe(false);

    await navigate('/about');
    expect(link.classList.contains('active')).toBe(true);

    // A sub-path of the href also counts as active.
    await navigate('/about/team');
    expect(link.classList.contains('active')).toBe(true);

    await navigate('/');
    expect(link.classList.contains('active')).toBe(false);
  });

  it('marks the link inactive when no route matches', async () => {
    createRouter(routes);
    const link = createLink({ href: '/about', children: 'About', activeClass: 'active' });
    disposables.push(link);
    await navigate('/about');
    expect(link.classList.contains('active')).toBe(true);

    await navigate('/nowhere');
    expect(link.classList.contains('active')).toBe(false);
  });
});

// ============================================================================
// 7. Page teardown on navigation
// ============================================================================
//
// renderComponent attaches the page's captured teardown as `node.__cleanup`,
// and the LoadResult cleanup that runs on navigation is what invokes it. Both
// halves are needed: drop the `__cleanup?.()` call and the outgoing page's
// effects keep firing against the long-lived router signals for the life of
// the page, and its onDestroy hooks never run — silently, with the DOM swap
// still looking correct. These tests fail if that call goes missing.
// ============================================================================

describe('page teardown on navigation', () => {
  /**
   * A page whose setup subscribes to `source` and registers onDestroy, so the
   * test can observe whether navigating away actually tore the page down.
   */
  const trackedPage = (
    name: string,
    source: () => number,
    counters: { runs: number; destroyed: number },
  ) => ({
    default: {
      setup(): Record<string, unknown> {
        onDestroy(() => {
          counters.destroyed++;
        });
        effect(() => {
          source();
          counters.runs++;
        });
        return {};
      },
      render(): Node {
        const el = document.createElement('div');
        el.setAttribute('data-page', name);
        return el;
      },
    },
  });

  it('disposes the outgoing page effects and runs onDestroy', async () => {
    const source = signal(0);
    const counters = { runs: 0, destroyed: 0 };
    createRouter([
      { path: '/', component: () => Promise.resolve(trackedPage('home', source, counters)) },
      { path: '/about', component: () => Promise.resolve(pageModule('about')) },
    ]);
    const container = renderView();
    await flush();
    expect(container.querySelector('[data-page="home"]')).not.toBeNull();
    expect(counters.runs).toBe(1);

    // still mounted — the page's effect reacts.
    source.set(1);
    expect(counters.runs).toBe(2);

    await navigate('/about');
    await flush();
    expect(container.querySelector('[data-page="about"]')).not.toBeNull();
    expect(counters.destroyed).toBe(1);

    // navigated away — the effect must be dead, not merely detached.
    const runsAtUnmount = counters.runs;
    source.set(2);
    source.set(3);
    expect(counters.runs).toBe(runsAtUnmount);
  });

  it('disposes a page wrapped in a layout, not just the layout node', async () => {
    const source = signal(0);
    const counters = { runs: 0, destroyed: 0 };
    createRouter([
      {
        path: '/',
        component: () => Promise.resolve(trackedPage('home', source, counters)),
        layout: () => Promise.resolve(layoutModule('root')),
      },
      { path: '/about', component: () => Promise.resolve(pageModule('about')) },
    ]);
    const container = renderView();
    await flush();
    // only the layout node is in the DOM, but the page node owns the effects.
    expect(container.querySelector('[data-layout="root"]')).not.toBeNull();
    expect(counters.runs).toBe(1);

    await navigate('/about');
    await flush();
    expect(counters.destroyed).toBe(1);

    const runsAtUnmount = counters.runs;
    source.set(1);
    expect(counters.runs).toBe(runsAtUnmount);
  });

  it('disposes a rendered error component when navigating away from it', async () => {
    const source = signal(0);
    const counters = { runs: 0, destroyed: 0 };
    createRouter([
      {
        path: '/broken',
        component: () => Promise.reject(new Error('boom')),
        error: () => Promise.resolve(trackedPage('boom', source, counters)),
      },
      { path: '/about', component: () => Promise.resolve(pageModule('about')) },
    ]);
    const container = renderView();
    await navigate('/broken');
    await flush();
    expect(container.querySelector('[data-page="boom"]')).not.toBeNull();
    expect(counters.runs).toBe(1);

    await navigate('/about');
    await flush();
    expect(counters.destroyed).toBe(1);

    const runsAtUnmount = counters.runs;
    source.set(1);
    expect(counters.runs).toBe(runsAtUnmount);
  });
});
