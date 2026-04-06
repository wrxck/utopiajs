# @matthesketh/utopia-core

Fine-grained signals reactivity system. Inspired by SolidJS/Preact Signals.

## install

```bash
npm install @matthesketh/utopia-core
```

## signal()

Creates a writable reactive signal.

```ts
import { signal } from '@matthesketh/utopia-core'

const count = signal(0)

count()           // read (tracked) — returns 0
count.value       // read (tracked) — returns 0
count.peek()      // read (untracked)
count.set(1)      // write
count.update(n => n + 1)  // write via callback
```

## computed()

Creates a lazy derived signal. Only recomputes when dependencies change and the value is read.

```ts
import { signal, computed } from '@matthesketh/utopia-core'

const count = signal(2)
const double = computed(() => count() * 2)

double()       // 4
double.value   // 4
double.peek()  // untracked read
```

## effect()

Runs a side-effect eagerly and re-runs when dependencies change. Returns a dispose function.

```ts
import { signal, effect } from '@matthesketh/utopia-core'

const name = signal('Alice')

const dispose = effect(() => {
  console.log('hello', name())
  return () => console.log('cleanup')  // optional cleanup
})

name.set('Bob')  // logs "cleanup" then "hello Bob"
dispose()        // stop the effect
```

## batch()

Defers effect execution until the batch completes — effects with multiple dependencies only run once.

```ts
import { signal, batch } from '@matthesketh/utopia-core'

const a = signal(1)
const b = signal(2)

batch(() => {
  a.set(10)
  b.set(20)
})
// effects depending on a and b run once, not twice
```

## untrack()

Reads signals inside a function without registering them as dependencies.

```ts
import { signal, effect, untrack } from '@matthesketh/utopia-core'

const a = signal(1)
const b = signal(2)

effect(() => {
  const x = a()                 // tracked
  const y = untrack(() => b())  // not tracked
  console.log(x, y)
})
```

## onEffectError()

Register a global handler for errors thrown inside effects.

```ts
import { onEffectError } from '@matthesketh/utopia-core'

const restore = onEffectError((err) => console.error('effect error', err))
// later:
restore()
```

## sharedSignal()

A signal that syncs its value across browser tabs via `BroadcastChannel`. Falls back to a plain signal in SSR environments.

```ts
import { sharedSignal } from '@matthesketh/utopia-core'

const theme = sharedSignal('theme', 'light')

theme.set('dark')  // broadcasts to all open tabs
theme.close()      // tear down the channel
```
