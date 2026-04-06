# @matthesketh/utopia-vite-plugin

Vite plugin for UtopiaJS. Transforms `.utopia` single-file components, handles CSS extraction via virtual modules, and provides granular HMR.

## install

```bash
npm install -D @matthesketh/utopia-vite-plugin
```

## vite.config.ts setup

### using defineConfig (recommended)

```ts
import { defineConfig } from '@matthesketh/utopia-vite-plugin'

export default defineConfig({
  // optional vite overrides
})
```

`defineConfig` automatically:
- adds the utopia plugin
- adds `.utopia` to `resolve.extensions`
- excludes UtopiaJS packages from dep pre-bundling
- sets `ssr.noExternal` for the UtopiaJS packages

### manual setup

```ts
import { defineConfig } from 'vite'
import utopia from '@matthesketh/utopia-vite-plugin'

export default defineConfig({
  plugins: [utopia()],
})
```

## plugin options

```ts
utopia({
  include: '**/*.utopia',     // default — glob to include
  exclude: undefined,         // glob to exclude
  routesDir: 'src/routes',   // default — routes directory for virtual:utopia-routes
})
```

## virtual:utopia-routes

The plugin exposes a virtual module that auto-discovers route files and builds the route table:

```ts
import routes from 'virtual:utopia-routes'
import { createRouter } from '@matthesketh/utopia-router'

createRouter(routes)
```

Route files matched: `src/routes/**/+{page,layout,error,server}.{utopia,ts,js}`

## HMR behaviour

- style-only changes trigger a CSS-only hot update (no component re-render)
- template or script changes trigger a full component update
- `+page`, `+layout`, `+error`, `+server` file additions/removals trigger a full page reload to rebuild the route table
- test block changes are ignored entirely (no browser update)

## SSR

During SSR builds, the plugin automatically aliases `@matthesketh/utopia-runtime` to `@matthesketh/utopia-server/ssr-runtime` so components render correctly on the server.
