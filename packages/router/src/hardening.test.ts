// regression tests for the v0.8 router hardening pass: malformed percent-escape
// handling in route matching.

import { describe, it, expect } from 'vitest';

import { compilePattern, matchRoute } from './matcher';
import type { Route } from './types';

function routeFor(pattern: string): Route[] {
  const { regex, params } = compilePattern(pattern);
  return [{ pattern: regex, params } as unknown as Route];
}

describe('matchRoute tolerates malformed percent-encoding', () => {
  it('falls back to the raw segment instead of throwing a URIError', () => {
    const routes = routeFor('/blog/:slug');
    const url = new URL('http://x.test/blog/%E0%A4');
    expect(() => matchRoute(url, routes)).not.toThrow();
    const match = matchRoute(url, routes);
    expect(match).not.toBeNull();
    expect(match!.params.slug).toBe('%E0%A4');
  });

  it('still decodes valid encodings', () => {
    const match = matchRoute(new URL('http://x.test/blog/hello%20world'), routeFor('/blog/:slug'));
    expect(match!.params.slug).toBe('hello world');
  });
});
