/**
 * Hydrating a server-rendered routed app, then navigating on the client.
 *
 * The markup is the exact string the server-routing test pins, so the two
 * halves of the contract cannot drift apart unnoticed.
 */

import { signal } from '@matthesketh/utopia-core';
import * as router from '@matthesketh/utopia-router';
import * as runtime from '@matthesketh/utopia-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ABOUT, APP, HOME, HOME_HTML, LAYOUT, loadComponent } from './fixtures/routing';

let host: HTMLElement;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  history.replaceState(null, '', '/');
  host = document.createElement('div');
  document.body.appendChild(host);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  router.destroy();
  host.remove();
});

function app() {
  const state = { name: signal('home'), flag: signal(true) };
  const mods = {
    '@matthesketh/utopia-runtime': runtime as unknown as Record<string, unknown>,
    '@matthesketh/utopia-router': router as unknown as Record<string, unknown>,
    'fixture-state': state,
  };
  const Layout = loadComponent(LAYOUT, mods);
  const Home = loadComponent(HOME, mods);
  const About = loadComponent(ABOUT, mods);
  return {
    state,
    App: loadComponent(APP, mods) as unknown as runtime.ComponentDefinition,
    routes: [
      {
        path: '/',
        component: async () => ({ default: Home }),
        layout: async () => ({ default: Layout }),
      },
      { path: '/about', component: async () => ({ default: About }) },
    ],
  };
}

describe('hydrating a routed app', () => {
  it('claims the server markup, stays live, and keeps routing', async () => {
    const { App, routes, state } = app();
    host.innerHTML = HOME_HTML;
    const serverParagraph = host.querySelector('p');

    router.createRouter(routes);
    await router.preloadRoute();
    runtime.hydrate(App, host);

    expect(warn).not.toHaveBeenCalled();
    expect(host.querySelector('p')).toBe(serverParagraph);
    expect(host.querySelector('p')!.textContent).toBe('Hello home!');

    state.name.set('ada');
    state.flag.set(false);
    await runtime.nextTick();
    expect(host.querySelector('p')!.textContent).toBe('Hello ada!');
    expect(host.querySelector('b')).toBeNull();

    await router.navigate('/about');
    await new Promise((r) => setTimeout(r, 0));
    expect(host.querySelector('[data-utopia-router-view]')!.textContent).toBe('About');
  });
});
