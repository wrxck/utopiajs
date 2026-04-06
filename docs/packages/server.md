# @matthesketh/utopia-server

SSR rendering and HTTP handler for UtopiaJS applications.

## install

```bash
npm install @matthesketh/utopia-server
```

## SSR setup

The scaffolder (`npx create-utopia` with SSR enabled) generates the required entry files and `server.js`. The standard pattern:

**`src/entry-server.ts`** — exports a `render` function:

```ts
import { renderToString } from '@matthesketh/utopia-server'
import App from './App.utopia'

export async function render(url: string) {
  return renderToString(App, { url })
}
```

**`src/entry-client.ts`** — hydrates the server-rendered HTML:

```ts
import { mount } from '@matthesketh/utopia-runtime'
import App from './App.utopia'

mount(App, '#app')
```

**`index.html`** markers:

```html
<head>
  <!--ssr-head-->
</head>
<body>
  <div id="app"><!--ssr-outlet--></div>
</body>
```

## createHandler()

Creates a Node.js HTTP request handler (compatible with Express middleware).

```ts
import { createHandler } from '@matthesketh/utopia-server'
import fs from 'node:fs'

const template = fs.readFileSync('dist/client/index.html', 'utf-8')
const { render } = await import('./dist/server/entry-server.js')

const handler = createHandler({
  template,
  render,
  // optional
  nonce: () => crypto.randomUUID(),
  apiRoutes: import.meta.glob('./src/routes/**/+server.ts'),
})

// with Node's http module
import { createServer } from 'node:http'
createServer(handler).listen(3000)

// or as Express middleware
app.use('*', handler)
```

`HandlerOptions`:

| option | type | description |
|---|---|---|
| `template` | `string` | HTML template with `<!--ssr-head-->` and `<!--ssr-outlet-->` markers |
| `render` | `(url: string) => Promise<{ html, css, head? }>` | SSR render function |
| `nonce` | `() => string` | optional per-request CSP nonce generator |
| `apiRoutes` | `Record<string, () => Promise<...>>` | optional glob manifest for `+server.ts` API routes |

## renderToString()

Render a component to an HTML string.

```ts
import { renderToString } from '@matthesketh/utopia-server'

const { html, css, head } = await renderToString(App, { url: '/about' })
```

## renderToStream()

Streaming SSR — returns a Node.js `Readable`.

```ts
import { renderToStream } from '@matthesketh/utopia-server'

const stream = renderToStream(App, { url: '/' })
stream.pipe(res)
```

## createServerRouter()

Build a server-side route table from a file glob manifest.

```ts
import { createServerRouter } from '@matthesketh/utopia-server'

const router = createServerRouter(import.meta.glob('./src/routes/**/*.utopia'))
```

## API routes

`+server.ts` files export HTTP method handlers:

```ts
// src/routes/api/hello/+server.ts
export function GET(req: Request): Response {
  return new Response(JSON.stringify({ hello: 'world' }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json()
  return new Response(JSON.stringify(body), { status: 201 })
}
```
