/**
 * The app create-utopia scaffolds must actually run.
 *
 * Its App.utopia wrapped createRouterView as `{ render() { return
 * createRouterView() } }`, which returns a component definition where a DOM
 * node is due, so every new router app crashed on mount — and the template's
 * own smoke test asserted that shape. This mounts the real template files.
 */

import fs from 'node:fs';
import os from 'node:os';
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

describe('the scaffolded blog', () => {
  it('lists posts and follows the route between posts', async () => {
    // generate a real content project with the CLI's own scaffolder.
    const { scaffoldProject } = await import('../../create-utopia/src/index');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utopia-blog-'));
    try {
      scaffoldProject(path.join(root, 'app'), {
        projectName: 'blog',
        language: 'typescript',
        useRouter: true,
        useSSR: false,
        useEmail: false,
        useAI: false,
        useContent: true,
        cssPreprocessor: 'none',
        initGit: false,
      });
      const routes = path.join(root, 'app', 'src', 'routes', 'blog');
      const collections = {
        blog: [
          { slug: 'first', data: { title: 'First', date: '2026-01-01' }, html: '<p>one</p>' },
          { slug: 'second', data: { title: 'Second', date: '2026-02-01' }, html: '<p>two</p>' },
          { slug: 'hidden', data: { title: 'Hidden', date: '2026-03-01', draft: true } },
        ],
      };
      const mods = { ...modules, 'virtual:utopia-content': { collections } };
      const List = loadComponent(fs.readFileSync(path.join(routes, '+page.utopia'), 'utf8'), mods);
      const Post = loadComponent(
        fs.readFileSync(path.join(routes, '[slug]', '+page.utopia'), 'utf8'),
        mods,
      );

      history.replaceState(null, '', '/blog');
      router.createRouter([
        { path: '/blog', component: async () => ({ default: List }) },
        { path: '/blog/:slug', component: async () => ({ default: Post }) },
      ]);
      const host = document.createElement('div');
      document.body.appendChild(host);
      runtime.mount({ render: () => router.createRouterView().render() } as never, host);
      await new Promise((r) => setTimeout(r, 0));

      // newest first, drafts hidden
      expect([...host.querySelectorAll('h2')].map((h) => h.textContent!.trim())).toEqual([
        'Second',
        'First',
      ]);

      await router.navigate('/blog/first');
      await new Promise((r) => setTimeout(r, 0));
      expect(host.querySelector('h1')!.textContent).toBe('First');

      // the page module is loaded once; its content must follow the route.
      await router.navigate('/blog/second');
      await new Promise((r) => setTimeout(r, 0));
      expect(host.querySelector('h1')!.textContent).toBe('Second');
      expect(host.querySelector('.content')!.innerHTML).toBe('<p>two</p>');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
