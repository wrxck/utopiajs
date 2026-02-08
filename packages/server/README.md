# @matthesketh/utopia-server

Server-side rendering for UtopiaJS. Provides `renderToString`, `renderToStream`, server-side routing, and an HTTP request handler. The SSR runtime is a drop-in replacement for `@matthesketh/utopia-runtime` that builds VNode trees instead of real DOM.

## Install

```bash
pnpm add @matthesketh/utopia-server
```

## Usage

```ts
import { renderToString } from '@matthesketh/utopia-server';
import App from './App.utopia';

const { html, css } = renderToString(App, { title: 'Hello' });
```

Streaming:

```ts
import { renderToStream } from '@matthesketh/utopia-server';
import App from './App.utopia';

const stream = renderToStream(App);
stream.pipe(res);
```

## API

| Export | Description |
|--------|-------------|
| `renderToString(component, props?)` | Render a component to `{ html, css }` synchronously. |
| `renderToStream(component, props?)` | Render to a Node.js `Readable` stream. |
| `createServerRouter(routes, url)` | Match a URL against routes on the server. |
| `createHandler(options)` | Create a Node.js HTTP request handler for SSR. |

**Subpath export:** `@matthesketh/utopia-server/ssr-runtime` -- drop-in replacement for `@matthesketh/utopia-runtime` used during SSR builds. The Vite plugin handles this swap automatically.

**VNode types:** `VElement`, `VText`, `VComment`, `VNode`.

See [docs/ssr.md](../../docs/ssr.md) for the full SSR architecture, hydration details, and setup guide.

## License

MIT
