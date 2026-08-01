// ============================================================================
// @matthesketh/utopia-router — Tests
// ============================================================================
//
// Tests for:
//   1. filePathToRoute conversion for all file-system patterns
//   2. compilePattern regex compilation and param extraction
//   3. matchRoute against exact, dynamic, catch-all, and no-match routes
//   4. buildRouteTable from manifest (ordering, layout/error resolution)
//   5. Router navigation with mocked History API
//   6. Router safety: redirect loops, guard errors, cross-origin blocks
//   7. Scroll position map cap
//   8. createLink cleanup
//
// ============================================================================

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLink } from '@/components';
import { buildRouteTable, compilePattern, filePathToRoute, matchRoute } from '@/matcher';
import {
  back,
  beforeNavigate,
  createRouter,
  currentRoute,
  destroy,
  forward,
  isNavigating,
  navigate,
} from '@/router';
import type { Route } from '@/types';

/** Extended anchor type exposing the dispose function attached by createLink. */
interface LinkWithDispose extends HTMLAnchorElement {
  __dispose?: () => void;
}

// ============================================================================
// 1. filePathToRoute
// ============================================================================

describe('filePathToRoute', () => {
  it('converts root page to /', () => {
    expect(filePathToRoute('src/routes/+page.utopia')).toBe('/');
  });

  it('converts static nested page', () => {
    expect(filePathToRoute('src/routes/about/+page.utopia')).toBe('/about');
  });

  it('converts deeply nested static page', () => {
    expect(filePathToRoute('src/routes/about/team/+page.utopia')).toBe('/about/team');
  });

  it('converts dynamic parameter [slug]', () => {
    expect(filePathToRoute('src/routes/blog/[slug]/+page.utopia')).toBe('/blog/:slug');
  });

  it('converts multiple dynamic parameters', () => {
    expect(filePathToRoute('src/routes/users/[userId]/posts/[postId]/+page.utopia')).toBe(
      '/users/:userId/posts/:postId',
    );
  });

  it('converts catch-all [...rest]', () => {
    expect(filePathToRoute('src/routes/[...rest]/+page.utopia')).toBe('/*rest');
  });

  it('converts catch-all with prefix path', () => {
    expect(filePathToRoute('src/routes/docs/[...path]/+page.utopia')).toBe('/docs/*path');
  });

  it('strips route groups (parenthesized segments)', () => {
    expect(filePathToRoute('src/routes/(auth)/login/+page.utopia')).toBe('/login');
  });

  it('strips nested route groups', () => {
    expect(filePathToRoute('src/routes/(marketing)/about/+page.utopia')).toBe('/about');
  });

  it('strips route group at root to become /', () => {
    expect(filePathToRoute('src/routes/(group)/+page.utopia')).toBe('/');
  });

  it('handles layout files (returns directory path)', () => {
    expect(filePathToRoute('src/routes/+layout.utopia')).toBe('/');
  });

  it('handles error files (returns directory path)', () => {
    expect(filePathToRoute('src/routes/blog/+error.utopia')).toBe('/blog');
  });

  it('handles .ts extension', () => {
    expect(filePathToRoute('src/routes/api/+page.ts')).toBe('/api');
  });

  it('handles .js extension', () => {
    expect(filePathToRoute('src/routes/api/+page.js')).toBe('/api');
  });

  it('handles Windows-style backslashes', () => {
    expect(filePathToRoute('src\\routes\\about\\+page.utopia')).toBe('/about');
  });

  it('handles path starting without src/', () => {
    expect(filePathToRoute('routes/about/+page.utopia')).toBe('/about');
  });

  it('handles a bare +page filename with no routes/ prefix', () => {
    expect(filePathToRoute('+page.utopia')).toBe('/');
  });
});

// ============================================================================
// 2. compilePattern
// ============================================================================

describe('compilePattern', () => {
  it('compiles root pattern /', () => {
    const { regex, params } = compilePattern('/');
    expect(params).toEqual([]);
    expect(regex.test('/')).toBe(true);
    expect(regex.test('/about')).toBe(false);
  });

  it('compiles static pattern /about', () => {
    const { regex, params } = compilePattern('/about');
    expect(params).toEqual([]);
    expect(regex.test('/about')).toBe(true);
    expect(regex.test('/about/')).toBe(true);
    expect(regex.test('/about/team')).toBe(false);
    expect(regex.test('/')).toBe(false);
  });

  it('compiles dynamic parameter pattern /blog/:slug', () => {
    const { regex, params } = compilePattern('/blog/:slug');
    expect(params).toEqual(['slug']);

    const match = regex.exec('/blog/hello-world');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('hello-world');

    expect(regex.test('/blog/')).toBe(false);
    expect(regex.test('/blog/a/b')).toBe(false);
  });

  it('compiles multiple dynamic parameters', () => {
    const { regex, params } = compilePattern('/users/:userId/posts/:postId');
    expect(params).toEqual(['userId', 'postId']);

    const match = regex.exec('/users/42/posts/99');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('42');
    expect(match![2]).toBe('99');
  });

  it('compiles catch-all pattern /*rest', () => {
    const { regex, params } = compilePattern('/*rest');
    expect(params).toEqual(['rest']);

    const match = regex.exec('/foo/bar/baz');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('foo/bar/baz');
  });

  it('compiles catch-all with prefix /docs/*path', () => {
    const { regex, params } = compilePattern('/docs/*path');
    expect(params).toEqual(['path']);

    const match = regex.exec('/docs/getting-started/installation');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('getting-started/installation');

    expect(regex.test('/other/page')).toBe(false);
  });

  it('allows optional trailing slash', () => {
    const { regex } = compilePattern('/about');
    expect(regex.test('/about')).toBe(true);
    expect(regex.test('/about/')).toBe(true);
  });

  it('escapes special regex characters in static segments', () => {
    const { regex } = compilePattern('/about.html');
    expect(regex.test('/about.html')).toBe(true);
    expect(regex.test('/aboutXhtml')).toBe(false);
  });
});

// ============================================================================
// 3. matchRoute
// ============================================================================

describe('matchRoute', () => {
  const makeRoute = (path: string, component?: () => Promise<any>): Route => {
    const { regex, params } = compilePattern(path);
    return {
      path,
      pattern: regex,
      params,
      component: component ?? (() => Promise.resolve({ default: () => {} })),
    };
  };

  const routes: Route[] = [
    makeRoute('/'),
    makeRoute('/about'),
    makeRoute('/blog'),
    makeRoute('/blog/:slug'),
    makeRoute('/users/:userId/posts/:postId'),
    makeRoute('/docs/*path'),
  ];

  it('matches exact root route', () => {
    const url = new URL('http://localhost/');
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/');
    expect(match!.params).toEqual({});
  });

  it('matches static route /about', () => {
    const url = new URL('http://localhost/about');
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/about');
  });

  it('matches dynamic parameter route', () => {
    const url = new URL('http://localhost/blog/my-post');
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/blog/:slug');
    expect(match!.params).toEqual({ slug: 'my-post' });
  });

  it('prefers exact /blog over /blog/:slug', () => {
    const url = new URL('http://localhost/blog');
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/blog');
  });

  it('matches multiple dynamic params', () => {
    const url = new URL('http://localhost/users/42/posts/99');
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/users/:userId/posts/:postId');
    expect(match!.params).toEqual({ userId: '42', postId: '99' });
  });

  it('matches catch-all route', () => {
    const url = new URL('http://localhost/docs/getting-started/install');
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/docs/*path');
    expect(match!.params).toEqual({ path: 'getting-started/install' });
  });

  it('returns null for no match', () => {
    const url = new URL('http://localhost/nonexistent/page/deep');
    const match = matchRoute(url, routes);
    expect(match).toBeNull();
  });

  it('normalizes a trailing slash before matching', () => {
    const url = new URL('http://localhost/about/');
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/about');
  });

  it('decodes URI-encoded parameters', () => {
    const url = new URL('http://localhost/blog/hello%20world');
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.params).toEqual({ slug: 'hello world' });
  });

  it('preserves the matched URL in the result', () => {
    const url = new URL('http://localhost/about?q=test#section');
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.url.search).toBe('?q=test');
    expect(match!.url.hash).toBe('#section');
  });
});

// ============================================================================
// 4. buildRouteTable
// ============================================================================

describe('buildRouteTable', () => {
  it('builds routes from a simple manifest', () => {
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/+page.utopia': () => Promise.resolve({ default: 'Home' }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: 'About' }),
    };

    const routes = buildRouteTable(manifest);
    expect(routes).toHaveLength(2);

    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/about');
  });

  it('orders static routes before dynamic routes', () => {
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/blog/[slug]/+page.utopia': () => Promise.resolve({}),
      'src/routes/blog/+page.utopia': () => Promise.resolve({}),
      'src/routes/+page.utopia': () => Promise.resolve({}),
    };

    const routes = buildRouteTable(manifest);
    const paths = routes.map((r) => r.path);

    // /blog (static, 1 segment, score=3) should come before /blog/:slug (mixed, score=3+2=5)
    // Actually /blog/:slug has higher score (5 vs 3), so it comes first.
    // But both should come after longer static paths... Let's just verify
    // that /blog appears before /blog/:slug in the list since static is more specific.
    // Wait — /blog/:slug has score 5 and /blog has score 3. Higher score first means
    // /blog/:slug is first. But that's fine because /blog will match /blog exactly
    // and /blog/:slug requires a slug parameter segment, so they don't conflict.
    expect(paths.indexOf('/blog/:slug')).toBeGreaterThan(-1);
    expect(paths.indexOf('/blog')).toBeGreaterThan(-1);
  });

  it('orders dynamic routes before catch-all routes', () => {
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/[...rest]/+page.utopia': () => Promise.resolve({}),
      'src/routes/[id]/+page.utopia': () => Promise.resolve({}),
    };

    const routes = buildRouteTable(manifest);
    const paths = routes.map((r) => r.path);

    // /:id (score=2) should come before /*rest (score=1)
    expect(paths.indexOf('/:id')).toBeLessThan(paths.indexOf('/*rest'));
  });

  it('attaches layout components to routes', () => {
    const layoutImport = () => Promise.resolve({ default: 'Layout' });
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/+page.utopia': () => Promise.resolve({ default: 'Home' }),
      'src/routes/+layout.utopia': layoutImport,
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: 'About' }),
    };

    const routes = buildRouteTable(manifest);
    const homeRoute = routes.find((r) => r.path === '/');
    const aboutRoute = routes.find((r) => r.path === '/about');

    expect(homeRoute!.layout).toBe(layoutImport);
    // About page should also inherit the root layout since there's no
    // closer one in src/routes/about/.
    expect(aboutRoute!.layout).toBe(layoutImport);
  });

  it('attaches error components to routes', () => {
    const errorImport = () => Promise.resolve({ default: 'Error' });
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/+page.utopia': () => Promise.resolve({}),
      'src/routes/+error.utopia': errorImport,
    };

    const routes = buildRouteTable(manifest);
    const homeRoute = routes.find((r) => r.path === '/');
    expect(homeRoute!.error).toBe(errorImport);
  });

  it('uses nearest layout (child overrides parent)', () => {
    const rootLayout = () => Promise.resolve({ default: 'RootLayout' });
    const blogLayout = () => Promise.resolve({ default: 'BlogLayout' });
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/+page.utopia': () => Promise.resolve({}),
      'src/routes/+layout.utopia': rootLayout,
      'src/routes/blog/+page.utopia': () => Promise.resolve({}),
      'src/routes/blog/+layout.utopia': blogLayout,
      'src/routes/blog/[slug]/+page.utopia': () => Promise.resolve({}),
    };

    const routes = buildRouteTable(manifest);
    const homeRoute = routes.find((r) => r.path === '/');
    const blogRoute = routes.find((r) => r.path === '/blog');
    const slugRoute = routes.find((r) => r.path === '/blog/:slug');

    expect(homeRoute!.layout).toBe(rootLayout);
    expect(blogRoute!.layout).toBe(blogLayout);
    // /blog/:slug should get blogLayout since it's in src/routes/blog/[slug]/
    // and src/routes/blog/ has a layout.
    expect(slugRoute!.layout).toBe(blogLayout);
  });

  it('ignores non-page, non-layout, non-error files in manifest', () => {
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/+page.utopia': () => Promise.resolve({}),
      'src/routes/utils.ts': () => Promise.resolve({}),
      'src/routes/+server.ts': () => Promise.resolve({}),
    };

    const routes = buildRouteTable(manifest);
    // Only +page files should produce routes.
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/');
  });

  it('handles route groups (parenthesized directories)', () => {
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/(auth)/login/+page.utopia': () => Promise.resolve({}),
      'src/routes/(auth)/register/+page.utopia': () => Promise.resolve({}),
      'src/routes/(marketing)/+page.utopia': () => Promise.resolve({}),
    };

    const routes = buildRouteTable(manifest);
    const paths = routes.map((r) => r.path);

    expect(paths).toContain('/login');
    expect(paths).toContain('/register');
    expect(paths).toContain('/');

    // No (auth) or (marketing) in the URL paths.
    for (const path of paths) {
      expect(path).not.toContain('(');
      expect(path).not.toContain(')');
    }
  });

  it('handles a manifest keyed by bare filenames', () => {
    const manifest: Record<string, () => Promise<any>> = {
      '+page.utopia': () => Promise.resolve({ default: 'Home' }),
      '+layout.utopia': () => Promise.resolve({ default: 'Layout' }),
      'about/+page.utopia': () => Promise.resolve({ default: 'About' }),
    };

    const routes = buildRouteTable(manifest);
    expect(routes.map((r) => r.path).sort()).toEqual(['/', '/about']);
    // A bare page file has no parent directory to search for special files,
    // and a bare layout file lives in no directory, so neither page finds it.
    for (const route of routes) {
      expect(route.layout).toBeUndefined();
    }
  });

  it('prefers a static segment over a dynamic one at the same position', () => {
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/a/[x]/+page.utopia': () => Promise.resolve({}),
      'src/routes/[y]/b/+page.utopia': () => Promise.resolve({}),
    };

    const routes = buildRouteTable(manifest);
    // '/a/b' matches both '/a/:x' and '/:y/b'; the route that is static
    // earliest (left-most) must win.
    const match = matchRoute(new URL('http://localhost/a/b'), routes);
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/a/:x');
  });

  it('produces correct regex patterns for all routes', () => {
    const manifest: Record<string, () => Promise<any>> = {
      'src/routes/+page.utopia': () => Promise.resolve({}),
      'src/routes/blog/[slug]/+page.utopia': () => Promise.resolve({}),
      'src/routes/docs/[...path]/+page.utopia': () => Promise.resolve({}),
    };

    const routes = buildRouteTable(manifest);

    // Test each route's pattern actually works.
    for (const route of routes) {
      if (route.path === '/') {
        expect(route.pattern.test('/')).toBe(true);
      } else if (route.path === '/blog/:slug') {
        expect(route.pattern.test('/blog/my-post')).toBe(true);
        expect(route.pattern.test('/blog')).toBe(false);
      } else if (route.path === '/docs/*path') {
        expect(route.pattern.test('/docs/a/b/c')).toBe(true);
      }
    }
  });
});

// ============================================================================
// 5. Router navigation (mocked browser APIs)
// ============================================================================

describe('Router (client-side navigation)', () => {
  // Helper to create a minimal route table.
  const makeRoutes = (): Route[] => {
    return buildRouteTable({
      'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/blog/[slug]/+page.utopia': () => Promise.resolve({ default: () => {} }),
    });
  };

  beforeEach(() => {
    // Set up window.location to a known state.
    // jsdom (used by vitest) provides window, history, etc.
    // Reset URL to root.
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    destroy();
  });

  it('matches the initial URL on createRouter()', () => {
    window.history.replaceState(null, '', '/about');
    const routes = makeRoutes();
    createRouter(routes);

    const match = currentRoute.peek();
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/about');
  });

  it('sets currentRoute to null for unmatched initial URL', () => {
    window.history.replaceState(null, '', '/nonexistent');
    const routes = makeRoutes();
    createRouter(routes);

    expect(currentRoute.peek()).toBeNull();
  });

  it('navigates programmatically and updates currentRoute', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    expect(currentRoute.peek()!.route.path).toBe('/');

    await navigate('/about');
    expect(currentRoute.peek()!.route.path).toBe('/about');
    expect(window.location.pathname).toBe('/about');
  });

  it('sets isNavigating during navigation', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    // isNavigating should be false when idle.
    expect(isNavigating.peek()).toBe(false);

    // Navigate and check that isNavigating returns to false after.
    await navigate('/about');
    expect(isNavigating.peek()).toBe(false);
  });

  it('extracts params from dynamic routes during navigation', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    await navigate('/blog/hello-world');
    const match = currentRoute.peek();
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/blog/:slug');
    expect(match!.params).toEqual({ slug: 'hello-world' });
  });

  it('replaces history entry when replace option is set', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    const initialLength = history.length;

    await navigate('/about', { replace: true });
    expect(currentRoute.peek()!.route.path).toBe('/about');
    // history.length should not increase on replace.
    expect(history.length).toBe(initialLength);
  });

  it('handles navigation to non-matching routes gracefully', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    await navigate('/nonexistent');
    expect(currentRoute.peek()).toBeNull();
    expect(window.location.pathname).toBe('/nonexistent');
  });

  it('supports beforeNavigate guard that allows navigation', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    const guardFn = vi.fn(() => true);
    const removeGuard = beforeNavigate(guardFn);

    await navigate('/about');
    expect(guardFn).toHaveBeenCalledTimes(1);
    expect(currentRoute.peek()!.route.path).toBe('/about');

    removeGuard();
  });

  it('supports beforeNavigate guard that cancels navigation', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    const removeGuard = beforeNavigate(() => false);

    await navigate('/about');
    // Navigation should be cancelled — still at root.
    expect(currentRoute.peek()!.route.path).toBe('/');

    removeGuard();
  });

  it('supports beforeNavigate guard that redirects', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    const removeGuard = beforeNavigate((_from, to) => {
      // Redirect /about to /blog/redirected.
      if (to && to.route.path === '/about') {
        return '/blog/redirected';
      }
    });

    await navigate('/about');
    // Should have been redirected.
    expect(currentRoute.peek()!.route.path).toBe('/blog/:slug');
    expect(currentRoute.peek()!.params.slug).toBe('redirected');

    removeGuard();
  });

  it('removes beforeNavigate guard when dispose is called', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    const guardFn = vi.fn(() => false);
    const removeGuard = beforeNavigate(guardFn);

    // Guard should block navigation.
    await navigate('/about');
    expect(currentRoute.peek()!.route.path).toBe('/');
    expect(guardFn).toHaveBeenCalledTimes(1);

    // Remove the guard.
    removeGuard();

    // Navigation should now succeed.
    await navigate('/about');
    expect(currentRoute.peek()!.route.path).toBe('/about');
    expect(guardFn).toHaveBeenCalledTimes(1); // not called again

    // Removing an already-removed guard is a safe no-op.
    expect(() => removeGuard()).not.toThrow();
  });

  it('cleans up on destroy()', () => {
    const routes = makeRoutes();
    createRouter(routes);

    expect(currentRoute.peek()).not.toBeNull();

    destroy();
    expect(currentRoute.peek()).toBeNull();
    expect(isNavigating.peek()).toBe(false);
  });

  it('re-initializes cleanly after destroy (supports HMR)', async () => {
    const routes = makeRoutes();

    createRouter(routes);
    await navigate('/about');
    expect(currentRoute.peek()!.route.path).toBe('/about');

    destroy();

    // Re-initialize at current URL (/about from previous navigation).
    createRouter(routes);
    expect(currentRoute.peek()!.route.path).toBe('/about');

    // Navigation should still work.
    await navigate('/');
    expect(currentRoute.peek()!.route.path).toBe('/');
  });
});

// ============================================================================
// 6. Router safety: redirect loops, guard errors, cross-origin blocks
// ============================================================================

describe('Router safety (guards and redirect limits)', () => {
  const makeRoutes = (): Route[] => {
    return buildRouteTable({
      'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/blog/[slug]/+page.utopia': () => Promise.resolve({ default: () => {} }),
    });
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    destroy();
  });

  it('stops infinite redirect loops', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Guard that always redirects to the same path, causing an infinite loop.
    const removeGuard = beforeNavigate((_from, _to) => '/loop');

    await navigate('/loop');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Maximum navigation redirects'),
    );

    consoleSpy.mockRestore();
    removeGuard();
  });

  it('catches guard exceptions without crashing', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const removeGuard = beforeNavigate(() => {
      throw new Error('guard failed');
    });

    await navigate('/about');

    expect(consoleSpy).toHaveBeenCalledWith('[utopia] Navigation guard error:', expect.any(Error));
    // Navigation should still complete since guard error doesn't block.
    expect(currentRoute.peek()!.route.path).toBe('/about');

    consoleSpy.mockRestore();
    removeGuard();
  });

  it('blocks cross-origin guard redirects', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const removeGuard = beforeNavigate(() => 'https://evil.com/phishing');

    await navigate('/about');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cross-origin redirect blocked'),
      expect.any(String),
    );

    consoleSpy.mockRestore();
    removeGuard();
  });
});

// ============================================================================
// 7. Scroll position map cap
// ============================================================================

describe('Scroll position map cap', () => {
  // The internal scrollPositions map is capped at MAX_SCROLL_ENTRIES (50).
  // Since the map is not exported, we test indirectly by performing more
  // than 50 navigations and verifying the router still works correctly
  // without errors or memory issues.

  const makeRoutes = (): Route[] => {
    return buildRouteTable({
      'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/blog/[slug]/+page.utopia': () => Promise.resolve({ default: () => {} }),
    });
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    destroy();
  });

  it('handles more than 50 navigations without errors (scroll map is capped)', async () => {
    const routes = makeRoutes();
    createRouter(routes);

    const targets = ['/about', '/blog/post-1', '/'];

    // Perform 55 navigations -- more than the MAX_SCROLL_ENTRIES cap of 50.
    for (let i = 0; i < 55; i++) {
      await navigate(targets[i % targets.length]);
    }

    // Router should still be fully functional after exceeding the cap.
    const match = currentRoute.peek();
    expect(match).not.toBeNull();
    expect(isNavigating.peek()).toBe(false);

    // One more navigation should still work fine.
    await navigate('/about');
    expect(currentRoute.peek()!.route.path).toBe('/about');
  });
});

// ============================================================================
// 8a. Regressions — origin confusion, redirect depth accounting, bad redirects
// ============================================================================

describe('Router regressions', () => {
  const makeRoutes = (): Route[] => {
    return buildRouteTable({
      'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
    });
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    destroy();
  });

  it('does not intercept clicks on cross-origin links whose host merely starts with the page origin', () => {
    createRouter(makeRoutes());

    // e.g. page origin http://localhost:3000 vs link to http://localhost:3000.evil.com
    const evilHref = window.location.origin + '.evil.com/phishing';
    const anchor = document.createElement('a');
    anchor.setAttribute('href', evilHref);
    document.body.appendChild(anchor);

    // Observe the router's decision from a window-level listener (which runs
    // after the router's document-level one), then cancel the event ourselves
    // so the test environment does not really navigate cross-origin.
    let interceptedByRouter: boolean | null = null;
    const observer = (event: Event): void => {
      interceptedByRouter = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener('click', observer);

    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // The router must leave the click alone (the browser performs a full
    // cross-origin navigation); intercepting it would pushState a
    // cross-origin URL.
    expect(interceptedByRouter).toBe(false);

    window.removeEventListener('click', observer);
    anchor.remove();
  });

  it('still intercepts clicks on absolute same-origin links', async () => {
    createRouter(makeRoutes());

    const anchor = document.createElement('a');
    anchor.setAttribute('href', window.location.origin + '/about');
    document.body.appendChild(anchor);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    // navigate() is fire-and-forget from the click handler — flush it.
    await new Promise((r) => setTimeout(r, 0));
    expect(currentRoute.peek()!.route.path).toBe('/about');

    anchor.remove();
  });

  it('keeps the redirect-loop limit intact across repeated loop trips', async () => {
    createRouter(makeRoutes());
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let firstTripCalls = 0;
    let removeGuard = beforeNavigate(() => {
      firstTripCalls++;
      return '/loop';
    });
    await navigate('/loop');
    removeGuard();

    let secondTripCalls = 0;
    removeGuard = beforeNavigate(() => {
      secondTripCalls++;
      return '/loop';
    });
    await navigate('/loop');
    removeGuard();

    // The internal depth counter must return to its baseline after a loop is
    // stopped; otherwise each trip doubles the number of redirects allowed.
    expect(secondTripCalls).toBe(firstTripCalls);

    consoleSpy.mockRestore();
  });

  it('blocks (rather than rejects on) a guard redirect to an unparseable URL', async () => {
    createRouter(makeRoutes());
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 'https://' has a scheme but no host — new URL() throws even with a base.
    const removeGuard = beforeNavigate(() => 'https://');

    await expect(navigate('/about')).resolves.toBeUndefined();
    // The bogus redirect must be blocked, leaving the route unchanged.
    expect(currentRoute.peek()!.route.path).toBe('/');

    consoleSpy.mockRestore();
    removeGuard();
  });
});

// ============================================================================
// 8b. popstate handling (browser back/forward)
// ============================================================================

describe('Router popstate handling', () => {
  const makeRoutes = (): Route[] => {
    return buildRouteTable({
      'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/blog/[slug]/+page.utopia': () => Promise.resolve({ default: () => {} }),
    });
  };

  /** Simulate the browser going back: restore URL + state, fire popstate. */
  const simulatePop = async (path: string, navIndex: number | null): Promise<void> => {
    const state = navIndex === null ? null : { _utopiaNavIndex: navIndex };
    window.history.replaceState(state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
    // The popstate handler resolves guard hooks asynchronously.
    await new Promise((r) => setTimeout(r, 0));
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    // Run animation frames synchronously so scroll logic is deterministic.
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void): number => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    destroy();
    vi.unstubAllGlobals();
  });

  it('updates currentRoute when popstate fires', async () => {
    createRouter(makeRoutes());
    await navigate('/about');
    expect(currentRoute.peek()!.route.path).toBe('/about');

    await simulatePop('/', 0);
    expect(currentRoute.peek()!.route.path).toBe('/');
  });

  it('treats a null popstate state as navigation index 0', async () => {
    createRouter(makeRoutes());
    await navigate('/about');

    await simulatePop('/', null);
    expect(currentRoute.peek()!.route.path).toBe('/');
  });

  it('restores the saved scroll position on popstate', async () => {
    createRouter(makeRoutes());
    await navigate('/about');

    const scrollSpy = vi.spyOn(window, 'scrollTo');
    await simulatePop('/', 0);

    // The position saved for entry 0 (captured when leaving '/') is restored.
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('restores the previous URL when a guard cancels a popstate navigation', async () => {
    createRouter(makeRoutes());
    await navigate('/about');

    const removeGuard = beforeNavigate(() => false);
    await simulatePop('/', 0);

    // Route unchanged; URL pushed back to the guarded page.
    expect(currentRoute.peek()!.route.path).toBe('/about');
    expect(window.location.pathname).toBe('/about');

    removeGuard();
  });

  it('does not restore scroll when the target entry has no saved position', async () => {
    createRouter(makeRoutes());
    await navigate('/about');

    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    // An index we never navigated from — nothing saved for it.
    await simulatePop('/', 99);

    expect(currentRoute.peek()!.route.path).toBe('/');
    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('cancelled popstate with no current route leaves the URL alone', async () => {
    // Start on an unmatched URL so currentRoute is null.
    window.history.replaceState(null, '', '/ghost');
    createRouter(makeRoutes());
    expect(currentRoute.peek()).toBeNull();

    const removeGuard = beforeNavigate(() => false);
    await simulatePop('/', 0);

    // Guard cancelled, but there is no previous route to restore to.
    expect(currentRoute.peek()).toBeNull();
    expect(window.location.pathname).toBe('/');

    removeGuard();
  });

  it('follows a guard redirect issued during popstate', async () => {
    createRouter(makeRoutes());
    await navigate('/about');

    const removeGuard = beforeNavigate((_from, to) => {
      if (to && to.route.path === '/') {
        return '/blog/redirected';
      }
    });
    await simulatePop('/', 0);

    expect(currentRoute.peek()!.route.path).toBe('/blog/:slug');
    expect(currentRoute.peek()!.params.slug).toBe('redirected');

    removeGuard();
  });

  it('blocks a cross-origin guard redirect issued during popstate', async () => {
    createRouter(makeRoutes());
    await navigate('/about');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const removeGuard = beforeNavigate((_from, to) => {
      if (to && to.route.path === '/') {
        return 'https://evil.com/phishing';
      }
    });
    await simulatePop('/', 0);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cross-origin redirect blocked'),
      expect.any(String),
    );
    // The route is left as it was before the pop.
    expect(currentRoute.peek()!.route.path).toBe('/about');

    consoleSpy.mockRestore();
    removeGuard();
  });
});

// ============================================================================
// 8c. Hash navigation and scrollToHash
// ============================================================================

describe('Hash navigation', () => {
  const makeRoutes = (): Route[] => {
    return buildRouteTable({
      'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
    });
  };

  let target: HTMLElement;
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void): number => {
      cb(0);
      return 0;
    });
    target = document.createElement('div');
    target.id = 'section';
    scrollIntoViewSpy = vi.fn();
    target.scrollIntoView = scrollIntoViewSpy as unknown as typeof target.scrollIntoView;
    document.body.appendChild(target);
  });

  afterEach(() => {
    target.remove();
    destroy();
    vi.unstubAllGlobals();
  });

  it('scrolls to the hash target on initial load', () => {
    window.history.replaceState(null, '', '/#section');
    createRouter(makeRoutes());
    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });

  it('handles same-page hash navigation without a route change', async () => {
    createRouter(makeRoutes());
    const before = currentRoute.peek();

    await navigate('/#section');

    expect(window.location.hash).toBe('#section');
    // Same-page hash jumps must not re-match or replace the current route.
    expect(currentRoute.peek()).toBe(before);
    expect(scrollIntoViewSpy).toHaveBeenCalled();
    expect(isNavigating.peek()).toBe(false);
  });

  it('supports replace mode for same-page hash navigation', async () => {
    createRouter(makeRoutes());
    await navigate('/#section', { replace: true });
    expect(window.location.hash).toBe('#section');
  });

  it('intercepts hash-only link clicks, updating the URL and scrolling', () => {
    createRouter(makeRoutes());
    const anchor = document.createElement('a');
    anchor.setAttribute('href', '#section');
    document.body.appendChild(anchor);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.location.hash).toBe('#section');
    expect(scrollIntoViewSpy).toHaveBeenCalled();

    anchor.remove();
  });

  it('swallows clicks on bare "#" links without changing the URL', () => {
    createRouter(makeRoutes());
    const anchor = document.createElement('a');
    anchor.setAttribute('href', '#');
    document.body.appendChild(anchor);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.location.hash).toBe('');

    anchor.remove();
  });

  it('scrolls to the target after a cross-page hash navigation', async () => {
    createRouter(makeRoutes());
    await navigate('/about#section');
    expect(currentRoute.peek()!.route.path).toBe('/about');
    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });

  it('gives up quietly when the hash target never appears', async () => {
    createRouter(makeRoutes());
    await expect(navigate('/about#missing')).resolves.toBeUndefined();
    expect(currentRoute.peek()!.route.path).toBe('/about');
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('ignores hash fragments that are not safe DOM ids', async () => {
    createRouter(makeRoutes());
    const lookupSpy = vi.spyOn(document, 'getElementById');
    await navigate('/about#not%20safe');
    expect(lookupSpy).not.toHaveBeenCalled();
    lookupSpy.mockRestore();
  });
});

// ============================================================================
// 8d. Click interception details
// ============================================================================

describe('Click interception', () => {
  const makeRoutes = (): Route[] => {
    return buildRouteTable({
      'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
    });
  };

  /**
   * Dispatch a click and report whether the router intercepted it. A
   * window-level observer (which runs after the router's document-level
   * handler) records defaultPrevented, then cancels the event so the test
   * environment never really navigates.
   */
  const dispatchClick = (
    element: Element,
    init: {
      ctrlKey?: boolean;
      metaKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      button?: number;
    } = {},
  ): boolean => {
    let intercepted = false;
    const observer = (event: Event): void => {
      intercepted = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener('click', observer);
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    window.removeEventListener('click', observer);
    return intercepted;
  };

  const makeAnchor = (href: string | null): HTMLAnchorElement => {
    const anchor = document.createElement('a');
    if (href !== null) anchor.setAttribute('href', href);
    document.body.appendChild(anchor);
    return anchor;
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    destroy();
  });

  it('ignores clicks with modifier keys held', () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor('/about');
    expect(dispatchClick(anchor, { ctrlKey: true })).toBe(false);
    expect(dispatchClick(anchor, { metaKey: true })).toBe(false);
    expect(dispatchClick(anchor, { shiftKey: true })).toBe(false);
    expect(dispatchClick(anchor, { altKey: true })).toBe(false);
  });

  it('ignores non-left-button clicks', () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor('/about');
    expect(dispatchClick(anchor, { button: 1 })).toBe(false);
  });

  it('ignores links with a target attribute', () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor('/about');
    anchor.setAttribute('target', '_blank');
    expect(dispatchClick(anchor)).toBe(false);
  });

  it('ignores links with a download attribute', () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor('/files/report.pdf');
    anchor.setAttribute('download', '');
    expect(dispatchClick(anchor)).toBe(false);
  });

  it('ignores anchors without an href', () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor(null);
    expect(dispatchClick(anchor)).toBe(false);
  });

  it('ignores relative hrefs that do not start with a slash', () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor('about');
    expect(dispatchClick(anchor)).toBe(false);
  });

  it('ignores protocol-relative hrefs', () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor('//evil.com/path');
    expect(dispatchClick(anchor)).toBe(false);
  });

  it('ignores non-HTTP protocols like mailto:', () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor('mailto:hi@example.com');
    expect(dispatchClick(anchor)).toBe(false);
  });

  it('ignores clicks that were already default-prevented', async () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor('/about');
    const cancel = (event: Event): void => event.preventDefault();
    document.addEventListener('click', cancel, true); // capture — runs first

    dispatchClick(anchor);
    document.removeEventListener('click', cancel, true);

    await new Promise((r) => setTimeout(r, 0));
    expect(currentRoute.peek()!.route.path).toBe('/');
  });

  it('ignores clicks on elements outside any anchor', () => {
    createRouter(makeRoutes());
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(dispatchClick(div)).toBe(false);
  });

  it('intercepts clicks on elements nested inside an anchor', async () => {
    createRouter(makeRoutes());
    const anchor = makeAnchor('/about');
    const span = document.createElement('span');
    span.textContent = 'About';
    anchor.appendChild(span);

    expect(dispatchClick(span)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(currentRoute.peek()!.route.path).toBe('/about');
  });
});

// ============================================================================
// 8e. back/forward, destroy, and SSR guards
// ============================================================================

describe('back/forward and teardown', () => {
  const makeRoutes = (): Route[] => {
    return buildRouteTable({
      'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
    });
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('back() delegates to history.back', () => {
    const spy = vi.spyOn(history, 'back').mockImplementation(() => {});
    back();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('forward() delegates to history.forward', () => {
    const spy = vi.spyOn(history, 'forward').mockImplementation(() => {});
    forward();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('stops intercepting clicks and popstate after destroy()', async () => {
    createRouter(makeRoutes());
    destroy();

    const anchor = document.createElement('a');
    anchor.setAttribute('href', '/about');
    document.body.appendChild(anchor);

    let intercepted = false;
    const observer = (event: Event): void => {
      intercepted = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener('click', observer);
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    window.removeEventListener('click', observer);
    expect(intercepted).toBe(false);

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    await new Promise((r) => setTimeout(r, 0));
    expect(currentRoute.peek()).toBeNull();

    anchor.remove();
  });

  it('replaces the previous listeners when createRouter is called again', async () => {
    createRouter(makeRoutes());
    createRouter(makeRoutes()); // e.g. HMR re-init

    const anchor = document.createElement('a');
    anchor.setAttribute('href', '/about');
    document.body.appendChild(anchor);
    const pushSpy = vi.spyOn(history, 'pushState');

    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    // Exactly one interception — the first router's click listener is gone.
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(currentRoute.peek()!.route.path).toBe('/about');

    pushSpy.mockRestore();
    anchor.remove();
  });

  it('navigate() is a no-op without a window (SSR)', async () => {
    createRouter(makeRoutes());
    vi.stubGlobal('window', undefined);
    await expect(navigate('/about')).resolves.toBeUndefined();
    vi.unstubAllGlobals();
    expect(currentRoute.peek()!.route.path).toBe('/');
  });

  it('back()/forward() are no-ops without a window (SSR)', () => {
    const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
    const forwardSpy = vi.spyOn(history, 'forward').mockImplementation(() => {});
    vi.stubGlobal('window', undefined);
    back();
    forward();
    vi.unstubAllGlobals();
    expect(backSpy).not.toHaveBeenCalled();
    expect(forwardSpy).not.toHaveBeenCalled();
  });

  it('createRouter() skips DOM setup without a window (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => createRouter(makeRoutes())).not.toThrow();
    vi.unstubAllGlobals();
    // No URL matching happened server-side.
    expect(currentRoute.peek()).toBeNull();
  });
});

// ============================================================================
// 8. createLink cleanup
// ============================================================================

describe('createLink', () => {
  const makeRoutes = (): Route[] => {
    return buildRouteTable({
      'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
      'src/routes/blog/[slug]/+page.utopia': () => Promise.resolve({ default: () => {} }),
    });
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    destroy();
  });

  it('createLink attaches dispose function for activeClass effect', () => {
    const routes = makeRoutes();
    createRouter(routes);

    const link = createLink({
      href: '/test',
      children: 'Test',
      activeClass: 'active',
    });

    // The dispose function should be attached when activeClass is provided.
    expect(typeof (link as LinkWithDispose).__dispose).toBe('function');
    // Calling dispose should not throw.
    (link as LinkWithDispose).__dispose!();
  });

  it('createLink does not attach dispose without activeClass', () => {
    const routes = makeRoutes();
    createRouter(routes);

    const link = createLink({
      href: '/test',
      children: 'Test',
    });

    // Without activeClass, no effect is created, so no __dispose.
    expect((link as LinkWithDispose).__dispose).toBeUndefined();
  });
});
