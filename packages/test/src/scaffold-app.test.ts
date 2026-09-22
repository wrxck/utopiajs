/**
 * The app create-utopia scaffolds must actually run.
 *
 * Its App.utopia wrapped createRouterView as `{ render() { return
 * createRouterView() } }`, which returns a component definition where a DOM
 * node is due, so every new router app crashed on mount — and the template's
 * own smoke test asserted that shape. This mounts the real template files.
 */

import fs from 'node:fs';
import path from 'node:path';

import * as core from '@matthesketh/utopia-core';
import * as router from '@matthesketh/utopia-router';
import * as runtime from '@matthesketh/utopia-runtime';
import { afterEach, describe, expect, it } from 'vitest';

import { loadComponent } from './fixtures/routing';

const TEMPLATE = path.resolve(__dirname, '..', '..', 'create-utopia', 'template', 'src');
const read = (file: string): string => fs.readFileSync(path.join(TEMPLATE, file), 'utf8');

const modules = {
  '@matthesketh/utopia-core': core as unknown as Record<string, unknown>,
  '@matthesketh/utopia-runtime': runtime as unknown as Record<string, unknown>,
  '@matthesketh/utopia-router': router as unknown as Record<string, unknown>,
};

afterEach(() => {
  router.destroy();
  document.body.innerHTML = '';
});

describe('the scaffolded app', () => {
  it('mounts App.utopia and renders the home route inside its layout', async () => {
    history.replaceState(null, '', '/');
    const App = loadComponent(
      read('App.utopia'),
      modules,
    ) as unknown as runtime.ComponentDefinition;
    const Home = loadComponent(read('routes/+page.utopia'), modules);
    const About = loadComponent(read('routes/about/+page.utopia'), modules);
    const Layout = loadComponent(read('routes/+layout.utopia'), modules);

    router.createRouter([
      {
        path: '/',
        component: async () => ({ default: Home }),
        layout: async () => ({ default: Layout }),
      },
      {
        path: '/about',
        component: async () => ({ default: About }),
        layout: async () => ({ default: Layout }),
      },
    ]);
    const host = document.createElement('div');
    document.body.appendChild(host);

    expect(() => runtime.mount(App, host)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(host.querySelector('h1')!.textContent).toBe('Welcome to UtopiaJS');

    await router.navigate('/about');
    await new Promise((r) => setTimeout(r, 0));
    expect(host.querySelector('[data-utopia-router-view]')!.textContent).not.toContain(
      'Welcome to UtopiaJS',
    );
  });
});
