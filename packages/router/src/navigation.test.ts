// @vitest-environment happy-dom
/**
 * Navigation ordering, relative links and hash-only history moves.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  beforeNavigate,
  createRouter,
  currentRoute,
  destroy,
  isNavigating,
  navigate,
} from '@/router';

const page = async () => ({ default: {} });

afterEach(() => {
  destroy();
  document.body.innerHTML = '';
});

describe('overlapping navigations', () => {
  it('commits the latest navigation when an earlier one has a slow guard', async () => {
    history.replaceState(null, '', '/');
    createRouter([
      { path: '/', component: page },
      { path: '/a', component: page },
      { path: '/b', component: page },
    ]);
    beforeNavigate(async (_from, to) => {
      if (to?.url.pathname === '/a') await new Promise((r) => setTimeout(r, 20));
    });

    const slow = navigate('/a');
    const fast = navigate('/b');
    expect(isNavigating.peek()).toBe(true);
    await fast;
    // the slow navigation is still running its guard.
    expect(isNavigating.peek()).toBe(true);
    await slow;

    expect(currentRoute.peek()!.url.pathname).toBe('/b');
    expect(location.pathname).toBe('/b');
    expect(isNavigating.peek()).toBe(false);
  });
});

describe('relative links', () => {
  it('routes a query-only link on the client', async () => {
    history.replaceState(null, '', '/list');
    createRouter([{ path: '/list', component: page }]);
    const link = document.createElement('a');
    link.setAttribute('href', '?page=2');
    document.body.appendChild(link);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(location.search).toBe('?page=2');
  });
});

describe('hash-only history moves', () => {
  it('keeps the current page instead of remounting it', async () => {
    history.replaceState(null, '', '/doc');
    createRouter([{ path: '/doc', component: page }]);
    const before = currentRoute.peek();

    history.pushState({ _utopiaNavIndex: 1 }, '', '/doc#section');
    history.back();
    await new Promise((r) => setTimeout(r, 30));
    history.forward();
    await new Promise((r) => setTimeout(r, 30));

    expect(currentRoute.peek()).toBe(before);
  });
});
