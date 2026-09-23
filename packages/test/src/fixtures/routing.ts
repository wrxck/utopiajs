/**
 * A small routed app shared by the server-render and hydration tests, so the
 * hydration test hydrates exactly the markup the server test pins.
 *
 * Components are compiled from real `.utopia` source and evaluated against an
 * explicit module map, which stands in for the bundler: the server binds
 * `@matthesketh/utopia-runtime` to the SSR runtime, the client to the DOM one.
 */

import { compile } from '@matthesketh/utopia-compiler';

export type ModuleMap = Record<string, Record<string, unknown>>;

/** Compile an SFC and evaluate it, resolving its imports from `modules`. */
export function loadComponent(source: string, modules: ModuleMap): Record<string, unknown> {
  const { code } = compile(source, { filename: 'Fixture.utopia' });
  const bindings: string[] = [];
  const body = code
    .split('\n')
    .filter((line) => {
      const named = line.match(/^import \{([^}]+)\} from '([^']+)'/);
      if (named) {
        const spec = named[1].replace(/\s+as\s+/g, ': ');
        bindings.push(`const {${spec}} = __modules[${JSON.stringify(named[2])}];`);
        return false;
      }
      return !line.startsWith('import ');
    })
    .join('\n')
    .replace(/^export default /m, 'return ');
  return new Function('__modules', `${bindings.join('\n')}\n${body}`)(modules) as Record<
    string,
    unknown
  >;
}

export const APP = `<template>
  <div class="app"><nav><a href="/">Home</a></nav><RouterView /></div>
</template>
<script>
import { createRouterView as RouterView } from '@matthesketh/utopia-router';
</script>`;

export const LAYOUT = `<template>
  <section class="layout"><h1>Site</h1><slot /></section>
</template>`;

export const HOME = `<template>
  <main><p>Hello {{ name() }}!</p><b u-if="flag()">flag</b></main>
</template>
<script>
import { flag, name } from 'fixture-state';
</script>`;

export const ABOUT = `<template>
  <main><p>About</p></main>
</template>`;

/** What the server renders for `/`. */
export const HOME_HTML =
  '<div class="app"><nav><a href="/">Home</a></nav><div data-utopia-router-view>' +
  '<section class="layout"><h1>Site</h1><main><p>Hello <!--|-->home<!--|-->!</p>' +
  '<!--[--><b>flag</b><!--u-if--></main></section></div></div>';
