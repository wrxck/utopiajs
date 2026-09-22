# Upgrading to 0.15

0.15 is a correctness and security release. Most applications need no code
changes, but several fixes change observable output. Each section below says
what changed, why, and what to do.

Upgrade every `@matthesketh/utopia-*` package together. Hydration relies on
markers that only the 0.15 server writes (below); a 0.15 client given 0.14
markup falls back to the old claim order, which fails for most templates.

## Server markup contains hydration markers

**What changed.** Server-rendered HTML now contains two kinds of comment:

- `<!--|-->` between two adjacent non-empty text nodes (`Hello <!--|-->Ada<!--|-->!`)
- `<!--[-->` before every `u-if` / `u-for` range (`<!--[--><li>a</li><!--u-for-->`)

**Why.** HTML merges adjacent text nodes and gives no way to tell where a
directive's nodes begin. Without the markers, `hydrate()` could not claim
ordinary templates and left pages with dead bindings and duplicated nodes.

**What to do.** Update any test that asserts exact server HTML. Nothing else:
the client removes the markers as it hydrates.

## `aria-*` booleans render as `"true"` / `"false"`

**What changed.** `:aria-expanded="open()"` now renders `aria-expanded="true"`
or `aria-expanded="false"` on the client and the server. Before, `true` gave a
bare `aria-expanded=""` (which assistive tech treats as unset) and `false`
removed the attribute.

**What to do.** Nothing, unless a test or a CSS selector relied on the old
values (`[aria-expanded=""]`). `null` / `undefined` still remove the attribute.

## Components now dispose the reactivity their `setup` creates

**What changed.** A plain `effect()` or `computed()` created in a component's
`<script>` setup is disposed when the component unmounts. Before, it stayed
subscribed and kept running against an unmounted component.

**What to do.** If you relied on such an effect outliving its component, create
it outside the component (at module scope, or in your own `createRoot`).

## A `computed` that recomputes to an equal value stops there

**What changed.** An effect or computed that depends on a `computed` no longer
re-runs when that computed recomputes to an `Object.is`-equal value.

**What to do.** Nothing for correct code. An effect that needs to run on every
change of a source should read the source directly.

## `u-transition` now animates

**What changed.** The `u-transition` directive used to do nothing. A `u-if`
branch or `u-for` row with it now plays `name-enter-*` classes when it appears
after the first render, and stays in place while `name-leave-*` plays before it
is removed. Without a CSS transition, removal happens on the next task.

**What to do.** Remove `u-transition` from elements you do not want animated.

## Link interception follows the browser

**What changed.** The router resolves an `<a href>` against the current URL,
so relative links (`?page=2`, `./next`) now route on the client. A same-origin
link that no route matches is left to the browser — before, it showed the
client 404 view.

**What to do.** If you depended on the client 404 view for unknown links, add a
catch-all route (`src/routes/[...rest]/+page.utopia`).

## `useHead` callers merge (`@matthesketh/utopia-helmet`)

**What changed.** Several live `useHead()` calls merge in first-run order: a
later title wins, and a later tag replaces an earlier one with the same
identity. Before, each call cleared every managed tag, so a layout and a page
erased each other. An entry inside a component is removed when it unmounts.

**What to do.** Nothing for a single caller. `setHead()` still replaces the
whole managed head.

## `createMCPHandler` validates `Origin` (`@matthesketh/utopia-ai`)

**What changed.** A browser request whose `Origin` is not a loopback origin and
not the configured `corsOrigin` is rejected with 403, even without
`allowedOrigins`.

**What to do.** Browser clients on another origin: list them in
`allowedOrigins`, or set `corsOrigin` to that single origin. To keep the old,
unchecked behaviour, set `corsOrigin: '*'`. Requests without an `Origin` header
(server-side clients) are unaffected. Pass `authorize` if the server is
reachable from a network.

## API routes: streaming, cookies, order and `HEAD`

**What changed.** `createHandler` streams API response bodies, keeps every
`Set-Cookie`, answers `HEAD` from `GET` when a route exports no `HEAD`, and
matches API routes by specificity (`api/stats` before `api/[id]`).

**What to do.** Nothing, unless you relied on the buggy order. API routes are
fetch-style: `export async function POST({ request, params })` returns a
`Response`. Handlers written as Node `(req, res)` never worked with
`createHandler`; rewrite them, and use `sseResponse(stream)` from
`@matthesketh/utopia-ai` for AI streams.

## Server builds bundle the framework and carry component CSS

**What changed.** The Vite plugin adds every `@matthesketh/utopia-*` package to
`ssr.noExternal`, and compiles server transforms with `emitStyles`, so
`renderToString` returns component CSS. `virtual:utopia-routes` exports an empty
`apiManifest` in client builds.

**What to do.** Read `apiManifest` in server code only (your server entry).
`createHandler` injects the collected CSS into `<!--ssr-head-->`.

## Server rendering of routed apps

Routed apps can now be server-rendered. Replace a router-less server entry with:

```ts
// src/entry-server.ts
import { withRoute } from '@matthesketh/utopia-router'
import { renderToString } from '@matthesketh/utopia-server'
import routes from 'virtual:utopia-routes'
import App from './App.utopia'
export { apiManifest } from 'virtual:utopia-routes'

export function render(url: string) {
  return withRoute(routes, url, () => renderToString(App))
}
```

and hydrate with the route preloaded:

```ts
// src/entry-client.ts
createRouter(routes)
preloadRoute().then(() => hydrate(App, '#app'))
```

Use `createRouterView` itself as the component. A wrapper whose `render`
returns `createRouterView()` returns a definition where a node is due and fails
to mount:

```html
<script>
import { createRouterView as RouterView } from '@matthesketh/utopia-router'
</script>
```

## Smaller changes

- Static attribute values are entity-decoded: `title="a &amp; b"` renders
  `a & b`.
- A `<slot>` element's children render as fallback content when the slot is
  unfilled.
- A `u-transition` duration modifier must be whole milliseconds
  (`duration-300`); anything else is a compile error.
- Server `defineLazy` renders `<div data-utopia-lazy>` around its fallback,
  the container the client hydrates.
- Sanitised `u-html` renders empty on the server unless a sanitiser is
  installed with `setServerHtmlSanitizer()`; `u-html.raw` renders verbatim.
- `renderMarkdown` removes `javascript:`, `vbscript:` and non-media `data:`
  URLs from links and images.
- The content MCP `create_entry` tool writes only `md`, `json` and `yaml`, and
  only formats the collection lists.
- The `<test>` block plugin skips (and warns about) a hand-written
  `X.utopia.test.ts` instead of overwriting it.

## Deprecations

None. Nothing in this release keeps a legacy path that is scheduled for
removal. The one opt-out — `corsOrigin: '*'` on `createMCPHandler` — is a
supported configuration, not a deprecated one.
