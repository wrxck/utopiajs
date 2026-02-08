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
import { signal } from '@utopia/core'
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
         addEventListener, appendChild } from '@utopia/runtime'

// --- User script (from <script> block) ---
import { signal } from '@utopia/core'
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
- **Expression resolution** — template references are prefixed with `_ctx.` to access the component context; `u-for` item variables are bare (local scope)

## Reactivity System (`@utopia/core`)

The signals system provides five primitives:

| Primitive | Purpose |
|-----------|---------|
| `signal(value)` | Writable reactive cell. Read via `count()` or `count.value`, write via `count.set(v)` or `count.update(fn)`. |
| `computed(fn)` | Lazy derived value. Recomputes only when dependencies change and the value is read. |
| `effect(fn)` | Eager side-effect. Re-runs when dependencies change. Returns a dispose function. |
| `batch(fn)` | Groups multiple writes — effects only run once after the batch completes. |
| `untrack(fn)` | Reads signals inside `fn` without creating dependency subscriptions. |

Implementation details:
- **Diamond dependency handling** — each subscriber is notified at most once per batch
- **Conditional tracking** — subscriptions are rebuilt on each execution, so `if` branches only track what they actually read
- **Auto-batching** — a single `signal.set()` call automatically batches its downstream notifications

## Template Directives

| Syntax | Directive | Compiled to |
|--------|-----------|-------------|
| `{{ expr }}` | Text interpolation | `createTextNode` + `createEffect(() => setText(...))` |
| `@click="handler"` | Event binding | `addEventListener(el, 'click', _ctx.handler)` |
| `:attr="expr"` | Dynamic attribute | `createEffect(() => setAttr(el, 'attr', _ctx.expr))` |
| `u-if="cond"` | Conditional | `createComment('u-if')` + `createIf(anchor, () => cond, renderTrue)` |
| `u-for="item in list()"` | List rendering | `createComment('u-for')` + `createFor(anchor, () => list, renderFn)` |
| `u-model="sig"` | Two-way binding | `createEffect(() => setAttr(el, 'value', sig()))` + `addEventListener(el, 'input', ...)` |

## File-Based Routing (`@utopia/router`)

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

Summary: The Vite plugin swaps `@utopia/runtime` for `@utopia/server/ssr-runtime` during SSR builds and dev SSR. The SSR runtime builds a VNode tree instead of real DOM, serialized via `renderToString()`. On the client, `hydrate()` claims the existing DOM nodes with a cursor-based walker.

## Component Lifecycle

1. **`setup(props)`** — Runs once. Creates signals, computeds, and returns the template context.
2. **`render(ctx)`** — Runs once. Creates the DOM tree (or VNode tree on server), sets up effects.
3. **`mount(target)`** — Inserts the root node into the DOM. Injects scoped styles.
4. **`unmount()`** — Removes the root node and cleans up injected styles.

## Scheduler

The scheduler (`queueJob`, `nextTick`) batches DOM updates into microtasks. Multiple signal writes within the same synchronous block produce a single flush. On the server, the scheduler is a no-op.
