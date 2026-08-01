// ============================================================================
// @matthesketh/utopia-server — server router tests
// ============================================================================

import type { Route } from '@matthesketh/utopia-router';
import { compilePattern } from '@matthesketh/utopia-router';
import { describe, expect, it } from 'vitest';

import { createServerRouter } from './server-router';

function makeRoute(path: string): Route {
  const { regex, params } = compilePattern(path);
  return { path, pattern: regex, params, component: () => Promise.resolve({}) };
}

describe('createServerRouter', () => {
  const routes = [makeRoute('/'), makeRoute('/about'), makeRoute('/users/:id')];

  it('matches a static route', () => {
    const match = createServerRouter(routes, '/about');
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/about');
    expect(match!.params).toEqual({});
  });

  it('matches a dynamic route and extracts params', () => {
    const match = createServerRouter(routes, '/users/42');
    expect(match!.route.path).toBe('/users/:id');
    expect(match!.params).toEqual({ id: '42' });
  });

  it('ignores query strings when matching', () => {
    const match = createServerRouter(routes, '/users/7?tab=posts');
    expect(match!.params).toEqual({ id: '7' });
  });

  it('returns null when no route matches', () => {
    expect(createServerRouter(routes, '/missing')).toBeNull();
  });

  it('returns null for unparseable URL input', () => {
    expect(createServerRouter(routes, 'http://[invalid')).toBeNull();
  });
});
