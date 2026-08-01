# UtopiaJS Architecture

UtopiaJS is a compiler-first, signal-based UI framework with single-file components (`.utopia` files). It combines SvelteKit-style file-based routing with Vue-inspired SFCs and SolidJS-style fine-grained reactivity.

## Core Principles

1. **Compiler-first** — Templates compile to direct DOM operations. No virtual DOM at runtime.
2. **Fine-grained reactivity** — Signals track exactly which DOM nodes depend on which values.
3. **Runtime-agnostic compiled output** — The same compiled code runs on client (DOM) and server (VNodes) through a runtime swap.

## Monorepo Structure

```
packages/
  core/           Signals reactivity (signal, computed, effect, batch, untrack)
  compiler/       SFC parser + template compiler + scoped CSS
  runtime/        DOM helpers, directives, component lifecycle, scheduler, hydration
  server/         SSR: VNode runtime, renderToString, renderToStream, server router
  vite-plugin/    Vite transform for .utopia files, HMR, SSR alias resolution
  router/         File-based routing with History API, navigation guards
  create-utopia/  CLI scaffolding tool
```

## Compilation Pipeline

A `.utopia` single-file component:

```html
<template>
  <div>{{ count() }}</div>
  <button @click="increment">+1</button>
</template>

<script>
import { signal } from '@matthesketh/utopia-core'
const count = signal(0)
function increment() { count.update(n => n + 1) }
</script>

<style scoped>
div { color: blue; }
</style>
```

Compiles to:

```js
import { createElement, createTextNode, createEffect, setText, setAttr,
         addEventListener, appendChild } from '@matthesketh/utopia-runtime'

// --- User script (from <script> block) ---
import { signal } from '@matthesketh/utopia-core'
const count = signal(0)
function increment() { count.update(n => n + 1) }

// --- Render function (from <template> block) ---
export default function render(_ctx) {
  const _el0 = createElement('div')
  setAttr(_el0, 'data-u-a1b2c3', '')
  const _el1 = createTextNode('')
  createEffect(() => setText(_el1, String(_ctx.count())))
  appendChild(_el0, _el1)

  const _el2 = createElement('button')
  setAttr(_el2, 'data-u-a1b2c3', '')
  addEventListener(_el2, 'click', _ctx.increment)
  const _el3 = createTextNode('+1')
  appendChild(_el2, _el3)
  // ...
}
```

Key aspects:
- **All DOM operations are imported helpers** — never direct `document.*` or `.appendChild()` calls
- **Reactive bindings use `createEffect()`** — wraps signal reads so the DOM updates when signals change
- **Scoped styles** use data attributes (`data-u-xxxx`) applied to each element
- **Expression resolution** — template references are emitted bare: script variables are reachable by closure from module scope, and `u-for` item variables are parameters of the row's render function (see [The `u-for` row scope](#the-u-for-row-scope))

## Reactivity System (`@matthesketh/utopia-core`)

The signals system provides five primitives:

| Primitive | Purpose |
|-----------|---------|
| `signal(value)` | Writable reactive cell. Read via `count()` or `count.value`, write via `count.set(v)` or `count.update(fn)`. |
| `computed(fn)` | Lazy derived value. Recomputes only when dependencies change and the value is read. |
| `effect(fn, opts?)` | Eager side-effect. Re-runs when dependencies change. Returns a dispose function. `opts.scheduler` sends re-runs somewhere instead of running them inline — the DOM bindings pass `queueJob`. |
| `batch(fn)` | Groups multiple writes — effects only run once after the batch completes. |
| `untrack(fn)` | Reads signals inside `fn` without creating dependency subscriptions. |
| `tick()` | Promise resolving once pending DOM updates have been applied. |
| `flushSync(fn)` | Runs `fn` and applies the DOM updates it causes before returning. |

Implementation details:
- **Diamond dependency handling** — each subscriber is notified at most once per batch
- **Conditional tracking** — subscriptions are rebuilt on each execution, so `if` branches only track what they actually read
- **Auto-batching** — a single `signal.set()` call automatically batches its downstream notifications
- **Synchronous notification** — `signal.set()` notifies its subscribers *inside* the call, before it returns. A plain `effect` therefore re-runs partway through whatever function did the write. Anything the effect reads that is not itself reactive (a persisted copy, a global default, a DOM attribute) must be updated BEFORE the write, or use a scheduler so the effect runs after the synchronous work finishes.

## Template Directives

| Syntax | Directive | Compiled to |
|--------|-----------|-------------|
| `{{ expr }}` | Text interpolation | `createTextNode` + `createEffect(() => setText(...))` |
| `@click="handler"` | Event binding | `addEventListener(el, 'click', _ctx.handler)` |
| `:attr="expr"` | Dynamic attribute | `createEffect(() => setAttr(el, 'attr', _ctx.expr))` |
| `u-if="cond"` | Conditional | `createComment('u-if')` + `createIf(anchor, () => cond, renderTrue)` |
| `u-for="item in list()"` | List rendering | `createComment('u-for')` + `createFor(anchor, () => list, renderFn, key?)` |
| `u-model="sig"` | Two-way binding | `createEffect(() => setAttr(el, 'value', sig()))` + `addEventListener(el, 'input', ...)` |

### The `u-for` row scope

`createFor` reconciles by key and reuses a row's DOM node when its key survives
a list update — which is the point of `:key`, and why focus, caret and scroll
inside a row are preserved. The row therefore has to be told that it now holds a
*different* item, because a plain `item.name` read subscribes to nothing.

The loop variable stays an ordinary parameter of the row's render function, so
templates are written exactly as before. `createFor` passes a third argument, a
`ForItemScope`, and the codegen uses both halves of it:

- `scope.onUpdate(fn)` registers a rebinder the compiler emits at the top of the
  row; `createFor` calls it with the current item and index every time it reuses
  the row, reassigning the author's own parameter names.
- `scope.track()` is called in front of every expression the runtime evaluates
  inside an effect — interpolations, `:bindings`, `u-if`/`u-show`/`u-html`, and a
  nested `u-for`'s list expression — subscribing those effects to the row's
  version cell, which `createFor` bumps after rebinding.

`:key` and event handlers are deliberately *not* tracked: the key is evaluated
against the item being placed, and a handler is not run in an effect — it reads
the rebound parameter when it fires, so it always acts on the item its row
currently shows.

One gap remains, and it is the general props rule rather than anything specific
to lists: props are passed to a child component **as values**, evaluated once
when the row is created. `<Child :item="item" />` inside a `u-for` therefore
keeps the item the row was first rendered with. Pass a signal uncalled and read
it in the child, or keep the per-row markup in the row itself.

## File-Based Routing (`@matthesketh/utopia-router`)

SvelteKit-style conventions:

| File Path | URL Pattern |
|-----------|-------------|
| `src/routes/+page.utopia` | `/` |
| `src/routes/about/+page.utopia` | `/about` |
| `src/routes/blog/[slug]/+page.utopia` | `/blog/:slug` |
| `src/routes/[...rest]/+page.utopia` | `/*rest` (catch-all) |
| `src/routes/(auth)/login/+page.utopia` | `/login` (route group) |
| `src/routes/+layout.utopia` | Layout wrapper |
| `src/routes/+error.utopia` | Error boundary |

The router:
- Uses `history.pushState` for client-side navigation
- Intercepts `<a>` clicks for SPA navigation
- Supports `beforeNavigate` guards (sync or async, can cancel or redirect)
- Manages scroll position (save on leave, restore on back/forward)
- Exposes `currentRoute` and `isNavigating` as reactive signals

## SSR Architecture

See [docs/ssr.md](./ssr.md) for full details.

Summary: The Vite plugin swaps `@matthesketh/utopia-runtime` for `@matthesketh/utopia-server/ssr-runtime` during SSR builds and dev SSR. The SSR runtime builds a VNode tree instead of real DOM, serialized via `renderToString()`. On the client, `hydrate()` claims the existing DOM nodes with a cursor-based walker.

## Component Lifecycle

1. **`setup(props)`** — Runs once. Creates signals, computeds, and returns the template context.
2. **`render(ctx)`** — Runs once. Creates the DOM tree (or VNode tree on server), sets up effects.
3. **`mount(target)`** — Inserts the root node into the DOM. Injects scoped styles.
4. **`unmount()`** — Removes the root node and cleans up injected styles.

## Scheduler

The scheduler (`queueJob`, `tick`, exported from core and re-exported by the runtime as `nextTick`) batches DOM updates into microtasks. Every `{{ }}` interpolation and `:binding` the compiler emits goes through `createEffect`, which schedules its re-runs here, so multiple signal writes within one synchronous block produce a single DOM pass.

Two rules make this safe:

- **The first pass is synchronous.** Effects always run once inline on creation, so an element paints its initial value on mount rather than a microtask later.
- **Structural work is not scheduled.** `u-if` and `u-for` reconcile inline. Mounting a branch runs its own bindings' first pass, so a newly shown subtree is complete the moment it appears, and node identity, focus and caret preservation stay out of the queue. A microtask still precedes the frame, so nothing partial is ever painted.

User-authored `effect()` in a component `<script>` is deliberately *not* scheduled: it is application logic rather than rendering, and its ordering is something authors reason about directly.

Reading the DOM straight after a write therefore sees the previous frame. Await `tick()`, or wrap the write in `flushSync()` when you need it applied immediately:

```ts
flushSync(() => open.set(true));
panel.scrollTop = 0;              // the panel exists
```

On the server the scheduler runs jobs immediately — SSR is synchronous and the markup is serialised the moment it is built, so there is no microtask window to defer into.
