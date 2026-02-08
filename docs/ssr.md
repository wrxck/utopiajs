# Server-Side Rendering (SSR)

UtopiaJS supports server-side rendering through a **runtime swap** architecture. The same compiled `.utopia` component code runs on both client and server — only the underlying runtime implementation changes.

## How It Works

### The Runtime Swap

Compiled `.utopia` components import helpers from `@utopia/runtime`:

```js
import { createElement, createTextNode, appendChild, createEffect, ... } from '@utopia/runtime'
```

On the **client**, these are real DOM operations. On the **server**, a Vite alias redirects the import to `@utopia/server/ssr-runtime`, which provides identical function signatures that build a **VNode tree** (virtual nodes) instead of real DOM nodes. The VNode tree is then serialized to an HTML string.

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
                    (imports from @utopia/runtime)
                   /                    \
          [client build]            [SSR build]
          @utopia/runtime     @utopia/server/ssr-runtime
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

### `@utopia/server`

The server-side rendering package. Provides:

| Export | Description |
|--------|-------------|
| `renderToString(component, props?)` | Render a component to `{ html, css }` |
| `renderToStream(component, props?)` | Render to a Node.js `Readable` stream |
| `createServerRouter(routes, url)` | Match a URL against routes on the server |
| `createHandler(options)` | Create a Node.js HTTP request handler |

### `@utopia/server/ssr-runtime`

Drop-in replacement for `@utopia/runtime`. Not imported directly by user code — the Vite plugin handles the swap automatically. Exports the same function signatures as `@utopia/runtime`, operating on VNodes instead of DOM nodes.

Key behavioral differences from the client runtime:

| Behavior | Client (`@utopia/runtime`) | Server (`ssr-runtime`) |
|----------|---------------------------|------------------------|
| `createElement('div')` | Returns `HTMLDivElement` | Returns `VElement { type: 1, tag: 'div', ... }` |
| `addEventListener(el, 'click', fn)` | Attaches listener | No-op, returns `() => {}` |
| `effect(fn)` / `createEffect(fn)` | Tracks dependencies, re-runs on change | Runs `fn` once synchronously via `untrack()` |
| `createIf(anchor, cond, true, false?)` | Reactive — toggles branches on signal change | Evaluates once, inserts the matching branch |
| `createFor(anchor, list, render)` | Reactive — re-renders on list change | Evaluates once, renders all items |
| `queueJob(fn)` / `nextTick()` | Microtask scheduler | No-op |
| Signals (`signal`, `computed`, `batch`, `untrack`) | Fully reactive | Same — signals work normally on server |

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

### Manual Setup

If adding SSR to an existing project:

**1. Install dependencies:**

```bash
pnpm add @utopia/server express
```

**2. Create `src/entry-server.ts`:**

```ts
import { renderToString } from '@utopia/server'
import App from './App.utopia'

export function render(url: string): { html: string; css: string } {
  return renderToString(App)
}
```

**3. Create `src/entry-client.ts`:**

```ts
import { hydrate } from '@utopia/runtime'
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

```js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
    const url = req.originalUrl
    try {
      let template, render

      if (!isProduction) {
        template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8')
        template = await vite.transformIndexHtml(url, template)
        const mod = await vite.ssrLoadModule('/src/entry-server.ts')
        render = mod.render
      } else {
        template = fs.readFileSync(
          path.resolve(__dirname, 'dist/client/index.html'), 'utf-8')
        const mod = await import('./dist/server/entry-server.js')
        render = mod.render
      }

      const { html: appHtml, css } = render(url)
      let page = template
      page = page.replace('<!--ssr-head-->', css ? `<style>${css}</style>` : '')
      page = page.replace('<!--ssr-outlet-->', appHtml)

      res.status(200).set({ 'Content-Type': 'text/html' }).end(page)
    } catch (e) {
      if (!isProduction) vite.ssrFixStacktrace(e)
      console.error(e)
      res.status(500).end(e.message)
    }
  })

  app.listen(process.env.PORT || 3000, () => {
    console.log(`Server running at http://localhost:${process.env.PORT || 3000}`)
  })
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
import { hydrate } from '@utopia/runtime'
import App from './App.utopia'

hydrate(App, '#app')
```

### How the Cursor Works

When compiled template code runs during hydration:

- `createElement('div')` — claims the current DOM element and enters its children scope
- `createTextNode('hello')` — claims the current text node
- `createComment('u-if')` — claims the current comment node
- `appendChild(parent, child)` — no-op for non-elements (already in DOM); exits child scope for elements
- `addEventListener(el, 'click', fn)` — always runs normally (attaches to the claimed element)
- `effect(fn)` — always runs normally (establishes signal subscriptions)

In dev mode, hydration mismatches produce console warnings:
```
[utopia] Hydration mismatch: expected <div>, got [object Text]
```

## API Reference

### `renderToString(component, props?)`

Render a component to an HTML string synchronously.

```ts
import { renderToString } from '@utopia/server'
import App from './App.utopia'

const { html, css } = renderToString(App, { title: 'Hello' })
// html: '<div class="app"><h1>Hello</h1></div>'
// css:  '.app[data-u-abc123] { padding: 20px; }'
```

**Parameters:**
- `component` — A compiled `ComponentDefinition` (the default export of a `.utopia` file)
- `props` — Optional props to pass to the component's `setup()` function

**Returns:** `{ html: string, css: string }`
- `html` — The rendered HTML markup
- `css` — All scoped CSS collected during rendering, joined with newlines

### `renderToStream(component, props?)`

Render a component to a Node.js `Readable` stream. The stream emits collected CSS first (in a `<style>` tag), then the HTML chunks.

```ts
import { renderToStream } from '@utopia/server'
import App from './App.utopia'

const stream = renderToStream(App)
stream.pipe(res)
```

**Parameters:** Same as `renderToString`.

**Returns:** `Readable` stream

### `createServerRouter(routes, url)`

Match a URL against a route table on the server.

```ts
import { createServerRouter } from '@utopia/server'
import { buildRouteTable } from '@utopia/router'

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
import { createHandler } from '@utopia/server'

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
- `options.render` — Async function `(url: string) => Promise<{ html: string, css: string }>`

**Returns:** `(req: IncomingMessage, res: ServerResponse) => void`

The handler replaces:
- `<!--ssr-head-->` with `<style>` tags containing the collected CSS
- `<!--ssr-outlet-->` with the rendered HTML

### `hydrate(component, target)`

Hydrate a server-rendered component on the client.

```ts
import { hydrate } from '@utopia/runtime'
import App from './App.utopia'

hydrate(App, '#app')       // CSS selector
hydrate(App, document.getElementById('app'))  // DOM element
```

**Parameters:**
- `component` — A compiled `ComponentDefinition`
- `target` — CSS selector string or DOM `Element` containing the server-rendered HTML

**Throws** if the target element is not found.

## Vite Plugin SSR Support

The `@utopia/vite-plugin` automatically handles the runtime swap:

- **SSR builds** (`vite build --ssr`): The `config` hook adds a resolve alias mapping `@utopia/runtime` to `@utopia/server/ssr-runtime`
- **Dev SSR** (`vite.ssrLoadModule()`): The `resolveId` hook intercepts `@utopia/runtime` imports in SSR context and redirects them

The `defineConfig()` helper also sets `ssr.noExternal` for all UtopiaJS packages to ensure they are bundled (not treated as external Node modules) during SSR builds.

No configuration is needed beyond using the standard Utopia Vite plugin:

```ts
// vite.config.ts
import { defineConfig } from '@utopia/vite-plugin'

export default defineConfig()
```

## VNode Types

The SSR runtime builds a tree of VNodes, exported from `@utopia/server`:

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

During SSR, scoped CSS from components is collected rather than injected into the DOM (there is no DOM on the server). The `renderToString()` function returns the collected CSS as a string, which should be injected into the HTML template's `<head>`:

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
