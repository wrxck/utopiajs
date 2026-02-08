# @utopia/core

Fine-grained signals reactivity system for UtopiaJS.

## Install

```bash
pnpm add @utopia/core
```

## Usage

```ts
import { signal, computed, effect, batch, untrack } from '@utopia/core';

// Writable signal
const count = signal(0);
count();          // read (tracked)
count.value;      // read (tracked)
count.peek();     // read (untracked)
count.set(1);     // write
count.update(n => n + 1); // write via callback

// Lazy computed
const double = computed(() => count() * 2);
double();         // 4

// Reactive effect
const dispose = effect(() => {
  console.log('count is', count());
  return () => console.log('cleaning up');
});
dispose(); // stop watching

// Batch multiple writes
batch(() => {
  count.set(10);
  count.set(20);
}); // effects run once after batch

// Untracked reads
effect(() => {
  const tracked = count();
  const untracked_val = untrack(() => count());
});
```

## API

| Export | Description |
|--------|-------------|
| `signal(value)` | Writable reactive cell. Read via `()` or `.value`, write via `.set()` or `.update()`. |
| `computed(fn)` | Lazy derived value. Recomputes only when dependencies change and the value is read. |
| `effect(fn)` | Eager side-effect. Re-runs when dependencies change. Returns a dispose function. |
| `batch(fn)` | Groups multiple writes -- effects only run once after the batch completes. |
| `untrack(fn)` | Reads signals inside `fn` without creating dependency subscriptions. |

See [docs/architecture.md](../../docs/architecture.md) for full details on the reactivity system.

## License

AGPL-3.0-or-later
