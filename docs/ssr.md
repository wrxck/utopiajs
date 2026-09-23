# Server-Side Rendering (SSR)

UtopiaJS supports server-side rendering through a **runtime swap** architecture. The same compiled `.utopia` component code runs on both client and server — only the underlying runtime implementation changes.

## How It Works

### The Runtime Swap

Compiled `.utopia` components import helpers from `@matthesketh/utopia-runtime`:

```js
import { createElement, createTextNode, appendChild, createEffect, ... } from '@matthesketh/utopia-runtime'
```

On the **client**, these are real DOM operations. On the **server**, a Vite alias redirects the import to `@matthesketh/utopia-server/ssr-runtime`, which provides identical function signatures that build a **VNode tree** (virtual nodes) instead of real DOM nodes. The VNode tree is then serialized to an HTML string.

This means:

- **No separate SSR compiler mode** — one compilation output works everywhere
- **No virtual DOM at runtime** — client rendering still goes directly to the DOM
- VNodes are only used on the server, for serialization

### Architecture Overview

```
                    .utopia file
                        |
                    [compiler]
                        |
                compiled JS module
                    (imports from @matthesketh/utopia-runtime)
                   /                    \
          [client build]            [SSR build]
          @matthesketh/utopia-runtime     @matthesketh/utopia-server/ssr-runtime
          (real DOM ops)        (VNode tree ops)
               |                        |
          interactive app         HTML string
                                       |
                                  sent to browser
                                       |
                                  hydrate() claims
                                  existing DOM nodes
```

## Packages

### `@matthesketh/utopia-server`

The server-side rendering package. Provides:

| Export | Description |
|--------|-------------|
| `renderToString(component, props?)` | Render a component to `{ html, css }` |
| `renderToStream(component, props?)` | Render to a Node.js `Readable` stream |
| `createServerRouter(routes, url)` | Match a URL against routes on the server |
| `createHandler(options)` | Create a Node.js HTTP request handler |

### `@matthesketh/utopia-server/ssr-runtime`

Drop-in replacement for `@matthesketh/utopia-runtime`. Not imported directly by user code — the Vite plugin handles the swap automatically. Exports the same function signatures as `@matthesketh/utopia-runtime`, operating on VNodes instead of DOM nodes.

Key behavioral differences from the client runtime:

| Behavior | Client (`@matthesketh/utopia-runtime`) | Server (`ssr-runtime`) |
|----------|---------------------------|------------------------|
| `createElement('div')` | Returns `HTMLDivElement` | Returns `VElement { type: 1, tag: 'div', ... }` |
| `addEventListener(el, 'click', fn)` | Attaches listener | No-op, returns `() => {}` |
| `effect(fn)` / `createEffect(fn)` | Tracks dependencies, re-runs on change | Runs `fn` once synchronously via `untrack()` |
| `createIf(anchor, cond, true, false?)` | Reactive — toggles branches on signal change | Evaluates once, inserts the matching branch |
| `createFor(anchor, list, render, key?)` | Reactive — reconciles by key on list change, and rebinds a reused row's loop variables through the scope it passes to `render` | Evaluates once, renders all items, and passes an inert scope (nothing is ever reused, so the markup matches a first client render) |
| `queueJob(fn)` / `nextTick()` | Microtask scheduler | Runs the job at once (a server render is one synchronous pass) |
| Signals (`signal`, `computed`, `batch`, `untrack`) | Fully reactive | Same — signals work normally on server |
| `u-html` (sanitised) | Sanitised with `DOMParser` | Empty unless a sanitiser is installed with `setServerHtmlSanitizer()` from `@matthesketh/utopia-server/ssr-runtime`; the client fills it in on hydration |
| `u-html.raw` | Written verbatim | Written verbatim |
| `u-model` | Two-way binding | Renders the initial state: `value`, `checked`, textarea text, the selected `<option>` |
| `provide` / `inject` | Owner chain | The same owner chain |
| `defineLazy(loader, fallback)` | Loads, then swaps in | Renders the container and fallback; the client swaps the component in after hydration |
| Component `<style>` | Bundled by Vite | Collected into `css` — the Vite plugin compiles server transforms with `emitStyles` |

## Usage

### Project Setup

The easiest way to start is with the CLI:

```bash
npx create-utopia my-app
# Select "SSR" in the features prompt
```

This scaffolds:

```
my-app/
  index.html          # Has <!--ssr-head--> and <!--ssr-outlet--> markers
  server.js           # Express server (dev + production)
  src/
    entry-client.ts   # Client entry — calls hydrate()
    entry-server.ts   # Server entry — exports render(url)
    App.utopia        # Root component
  vite.config.ts
  package.json
```

### Routed apps

With `@matthesketh/utopia-router`, render the route for the request on the
server and preload the same route before hydrating on the client. `withRoute`
loads the route's modules first and then renders synchronously with that route
current, so concurrent requests cannot see each other's route.

```ts
// src/entry-server.ts
import { withRoute } from '@matthesketh/utopia-router'
import { renderToString } from '@matthesketh/utopia-server'
import routes from 'virtual:utopia-routes'
import App from './App.utopia'

// +server.ts API routes, for createHandler
export { apiManifest } from 'virtual:utopia-routes'

export function render(url: string) {
  return withRoute(routes, url, () => renderToString(App))
}
```

```ts
// src/entry-client.ts
import { createRouter, preloadRoute } from '@matthesketh/utopia-router'
import { hydrate } from '@matthesketh/utopia-runtime'
import routes from 'virtual:utopia-routes'
import App from './App.utopia'

createRouter(routes)
preloadRoute().then(() => hydrate(App, '#app'))
```

`App.utopia` uses `createRouterView` itself as the component:

```html
<template><main><RouterView /></main></template>
<script>
import { createRouterView as RouterView } from '@matthesketh/utopia-router'
</script>
```

The Vite plugin bundles the framework packages into the server build
(`ssr.noExternal`), so the router's own runtime imports reach the SSR runtime.

### Manual Setup

If adding SSR to an existing project:

**1. Install dependencies:**

```bash
pnpm add @matthesketh/utopia-server express
```

**2. Create `src/entry-server.ts`:**

```ts
import { renderToString } from '@matthesketh/utopia-server'
import App from './App.utopia'

export function render(url: string): { html: string; css: string } {
  return renderToString(App)
}
```

**3. Create `src/entry-client.ts`:**

```ts
import { hydrate } from '@matthesketh/utopia-runtime'
import App from './App.utopia'

hydrate(App, '#app')
```

**4. Update `index.html`:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
  <!--ssr-head-->
</head>
<body>
  <div id="app"><!--ssr-outlet--></div>
  <script type="module" src="/src/entry-client.ts"></script>
</body>
</html>
```

**5. Create `server.js`:**

`createHandler` renders the page into the `<!--ssr-outlet-->` and
`<!--ssr-head-->` markers, serves `+server.ts` API routes, and sets baseline
security headers.

```js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHandler } from '@matthesketh/utopia-server'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production'

async function createServer() {
  const app = express()
  let vite

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite')
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    })
    app.use(vite.middlewares)
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist/client')))
  }

  app.use('*', async (req, res) => {
    // express rewrites req.url under a mount; the handler needs the real one
    req.url = req.originalUrl
    try {
      let template, entry
      if (!isProduction) {
        template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8')
        template = await vite.transformIndexHtml(req.url, template)
        entry = await vite.ssrLoadModule('/src/entry-server.ts')
      } else {
        template = fs.readFileSync(path.resolve(__dirname, 'dist/client/index.html'), 'utf-8')
        entry = await import('./dist/server/entry-server.js')
      }
      await createHandler({
        template,
        apiRoutes: entry.apiManifest,
        render: (url) => entry.render(url),
      })(req, res)
    } catch (e) {
      if (!isProduction) vite.ssrFixStacktrace(e)
      console.error(e)
      res.status(500).end('Internal Server Error')
    }
  })

  app.listen(process.env.PORT || 3000)
}

createServer()
```

**6. Update `package.json` scripts:**

```json
{
  "scripts": {
    "dev": "node server.js",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build --outDir dist/client",
    "build:server": "vite build --outDir dist/server --ssr src/entry-server.ts",
    "preview": "NODE_ENV=production node server.js"
  }
}
```

### Build Commands

```bash
# Development (with HMR)
node server.js

# Production build
vite build --outDir dist/client              # Client bundle
vite build --outDir dist/server --ssr src/entry-server.ts  # Server bundle

# Run production server
NODE_ENV=production node server.js
```

## Hydration

After the server sends the rendered HTML, the client takes over by **hydrating** the existing DOM rather than recreating it. `hydrate()` uses a cursor-based DOM walker that:

1. Walks the existing DOM nodes in creation order
2. Claims each node instead of creating a new one (elements, text nodes, comments)
3. Attaches event listeners to the claimed elements
4. Sets up reactive effects so signals start tracking dependencies

```ts
// entry-client.ts
import { hydrate } from '@matthesketh/utopia-runtime'
import App from './App.utopia'

hydrate(App, '#app')
```

### How the Cursor Works

When compiled template code runs during hydration:

- `createElement('div')` — claims the current DOM element (the tag must match) and enters its children scope
- `createTextNode(...)` — claims the current text node
- `createComment('u-if')` — claims the directive's anchor (see ranges below)
- `appendChild(parent, child)` — no-op (the node is already in the DOM); exits the child scope for elements
- `addEventListener(el, 'click', fn)` — always runs normally (attaches to the claimed element)
- `effect(fn)` — always runs normally (establishes signal subscriptions)

### The server/client markup contract

HTML cannot say everything the client needs to claim nodes one for one, so the
server writes two kinds of marker comment:

- `<!--|-->` between two adjacent non-empty text nodes. The parser would
  otherwise merge `Hello {{ name }}!` into one text node. An interpolation that
  rendered empty has no markup at all; the client creates it in place.
- `<!--[-->` before every `u-if` / `u-for` range: `<!--[-->` branch or rows
  `<!--u-if-->`. The compiled code claims the anchor before it renders the
  branch, so the client skips the range when it claims the anchor, and
  `createIf` / `createFor` claim the range when they first render.

A node the server did not write is created and inserted at the cursor, a server
node the client did not claim is removed, and an element whose tag does not
match is replaced — so a mismatch stays a local repair instead of misaligning
the rest of the page. Mismatches are reported:

```
[utopia] Hydration mismatch: expected <div>, got [object Text]
```

The compiler's `fragments` option is not yet supported with hydration.

## API Reference

### `renderToString(component, props?)`

Render a component to an HTML string synchronously.

```ts
import { renderToString } from '@matthesketh/utopia-server'
import App from './App.utopia'

const { html, css } = renderToString(App, { title: 'Hello' })
// html: '<div class="app"><h1>Hello</h1></div>'
// css:  '.app[data-u-abc123] { padding: 20px; }'
```

**Parameters:**
- `component` — A compiled `ComponentDefinition` (the default export of a `.utopia` file)
- `props` — Optional props to pass to the component's `setup()` function

**Returns:** `{ html: string, css: string, head: HeadConfig[] }`
- `html` — The rendered HTML markup
- `css` — All component CSS collected during rendering, joined with newlines. A
  component carries its CSS as `styles` when it was compiled with `emitStyles`,
  which the Vite plugin does for every server transform.
- `head` — The entries collected by `useHead()` during rendering

### `renderToStream(component, props?)`

Render a component to a Node.js `Readable` stream. The stream emits collected CSS first (in a `<style>` tag), then the HTML chunks.

```ts
import { renderToStream } from '@matthesketh/utopia-server'
import App from './App.utopia'

const stream = renderToStream(App)
stream.pipe(res)
```

**Parameters:** Same as `renderToString`.

**Returns:** `Readable` stream

### `createServerRouter(routes, url)`

Match a URL against a route table on the server.

```ts
import { createServerRouter } from '@matthesketh/utopia-server'
import { buildRouteTable } from '@matthesketh/utopia-router'

const routes = buildRouteTable(routeManifest)
const match = createServerRouter(routes, '/blog/my-post')

if (match) {
  console.log(match.params) // { slug: 'my-post' }
}
```

**Parameters:**
- `routes` — Array of compiled `Route` objects from `buildRouteTable()`
- `url` — URL string to match (e.g. `'/blog/my-post'`)

**Returns:** `RouteMatch | null`

### `createHandler(options)`

Create a Node.js HTTP request handler for SSR.

```ts
import http from 'node:http'
import { createHandler } from '@matthesketh/utopia-server'

const handler = createHandler({
  template: '<html>...<!--ssr-head-->...<!--ssr-outlet-->...</html>',
  render: async (url) => {
    const { html, css } = renderToString(App)
    return { html, css }
  },
})

http.createServer(handler).listen(3000)
```

**Parameters:**
- `options.template` — HTML template string containing `<!--ssr-head-->` and `<!--ssr-outlet-->` markers
- `options.render` — Async function `(url: string) => Promise<{ html: string, css: string, head?: HeadConfig[] }>`
- `options.apiRoutes` — Optional glob manifest of `+server.ts` modules (`apiManifest` from `virtual:utopia-routes`)
- `options.nonce`, `options.csp`, `options.securityHeaders` — see the type definitions

**Returns:** `(req: IncomingMessage, res: ServerResponse) => void`

The handler replaces:
- `<!--ssr-head-->` with `<style>` tags containing the collected CSS
- `<!--ssr-outlet-->` with the rendered HTML

An API route is called with a fetch-style `RequestEvent` (`{ request, url,
params }`) and returns a `Response`. The handler streams the response body as
bytes (so server-sent events stream and binary bodies arrive intact), keeps
every `Set-Cookie`, answers `HEAD` from `GET` when a route has no `HEAD`
export, and matches routes by specificity (`api/stats` before `api/[id]`).

### `hydrate(component, target)`

Hydrate a server-rendered component on the client.

```ts
import { hydrate } from '@matthesketh/utopia-runtime'
import App from './App.utopia'

hydrate(App, '#app')       // CSS selector
hydrate(App, document.getElementById('app'))  // DOM element
```

**Parameters:**
- `component` — A compiled `ComponentDefinition`
- `target` — CSS selector string or DOM `Element` containing the server-rendered HTML

**Throws** if the target element is not found.

## Vite Plugin SSR Support

The `@matthesketh/utopia-vite-plugin` automatically handles the runtime swap:

- **SSR builds** (`vite build --ssr`): The `config` hook adds a resolve alias mapping `@matthesketh/utopia-runtime` to `@matthesketh/utopia-server/ssr-runtime`
- **Dev SSR** (`vite.ssrLoadModule()`): The `resolveId` hook intercepts `@matthesketh/utopia-runtime` imports in SSR context and redirects them

The plugin also sets `ssr.noExternal` for every `@matthesketh/utopia-*` package, so framework packages that import the runtime themselves (the router's `RouterView`) are bundled into the server build and reach the swap. A server transform compiles each component with `emitStyles`, which puts its CSS on the definition for `renderToString` to collect. `+server.ts` modules are globbed into server builds only.

No configuration is needed beyond using the standard Utopia Vite plugin:

```ts
// vite.config.ts
import { defineConfig } from '@matthesketh/utopia-vite-plugin'

export default defineConfig()
```

## VNode Types

The SSR runtime builds a tree of VNodes, exported from `@matthesketh/utopia-server`:

```ts
interface VElement {
  type: 1
  tag: string
  attrs: Record<string, string>
  children: VNode[]
  _parent?: VElement
}

interface VText {
  type: 2
  text: string
  _parent?: VElement
}

interface VComment {
  type: 3
  text: string
  _parent?: VElement
}

type VNode = VElement | VText | VComment
```

The `_parent` back-reference is used by `createIf` and `createFor` to insert nodes relative to their comment anchor.

## Signals on the Server

Signals (`signal()`, `computed()`) work normally on the server. They hold values and can be read. The key difference is that **effects run exactly once** (synchronously, without tracking dependencies). This means:

- `signal(0)` creates a signal with value `0` — works normally
- `computed(() => count() * 2)` derives a value — works normally
- `effect(() => setText(node, count()))` runs once to set the initial text, but does **not** subscribe to `count` — the effect will not re-run when `count` changes

This is correct for SSR because the server produces a single snapshot of the UI. There is no need for reactivity on the server.

## Scoped CSS Collection

During SSR, component CSS is collected rather than injected into the DOM (there is no DOM on the server). A component carries its CSS as `styles` when compiled with `emitStyles` — the Vite plugin does this for every server transform. The `renderToString()` function returns the collected CSS as a string, which should be injected into the HTML template's `<head>` (`createHandler` does this for you):

```ts
const { html, css } = renderToString(App)

// css contains all scoped styles from all components rendered
// Inject into <head> via the <!--ssr-head--> marker
template.replace('<!--ssr-head-->', `<style>${css}</style>`)
```

## Security

The SSR serializer escapes:

- **HTML text content**: `&`, `<`, `>` are escaped to prevent XSS
- **Attribute values**: `&`, `"` are escaped
- **Comment content**: `--` sequences are sanitized to prevent premature comment closure
