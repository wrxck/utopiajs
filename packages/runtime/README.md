# @matthesketh/utopia-runtime

DOM renderer, directives, component lifecycle, scheduler, and hydration for UtopiaJS. This is the client-side runtime that compiled `.utopia` components import from.

## Install

```bash
pnpm add @matthesketh/utopia-runtime
```

## Usage

```ts
import { mount } from '@matthesketh/utopia-runtime';
import App from './App.utopia';

mount(App, '#app');
```

For hydrating server-rendered HTML:

```ts
import { hydrate } from '@matthesketh/utopia-runtime';
import App from './App.utopia';

hydrate(App, '#app');
```

## API

**DOM helpers** (used by compiled template output):

| Export | Description |
|--------|-------------|
| `createElement(tag)` | Create a DOM element |
| `createTextNode(text)` | Create a text node |
| `createComment(text)` | Create a comment node |
| `setText(node, text)` | Set text content |
| `setAttr(el, name, value)` | Set an attribute |
| `addEventListener(el, event, handler)` | Attach an event listener |
| `appendChild(parent, child)` | Append a child node |
| `insertBefore(parent, node, ref)` | Insert before a reference node |
| `removeNode(node)` | Remove a node from the DOM |

**Directives** (used by compiled control-flow):

| Export | Description |
|--------|-------------|
| `createIf(anchor, cond, trueBranch, falseBranch?)` | Conditional rendering |
| `createFor(anchor, list, renderFn)` | List rendering |
| `createComponent(def, props?)` | Component instantiation |

**Lifecycle:**

| Export | Description |
|--------|-------------|
| `mount(component, target)` | Mount a component to the DOM |
| `createComponentInstance(def, props?)` | Create a component instance |
| `hydrate(component, target)` | Hydrate server-rendered HTML |

**Scheduler:**

| Export | Description |
|--------|-------------|
| `queueJob(fn)` | Queue a microtask job |
| `nextTick()` | Wait for the next flush |

**Re-exports from `@matthesketh/utopia-core`:** `signal`, `computed`, `effect`, `batch`, `untrack`, `createEffect`.

See [docs/architecture.md](../../docs/architecture.md) and [docs/ssr.md](../../docs/ssr.md) for full details.

## License

MIT
