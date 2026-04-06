# getting started

UtopiaJS is a Vite-based framework with signals reactivity, single-file `.utopia` components, file-based routing, and SSR.

## scaffold a project

```bash
npx create-utopia my-app
cd my-app
npm install
npm run dev
```

The CLI prompts for language (TypeScript/JavaScript) and optional features: router, SSR, email, AI, content/blog, CSS preprocessor.

## project structure

```
my-app/
  src/
    main.ts             # entry point
    App.utopia          # root component
    routes/             # file-based routes (if router enabled)
      +page.utopia      # /
      blog/
        +page.utopia    # /blog
  index.html
  vite.config.ts
  package.json
```

## dev commands

```bash
utopia dev              # start dev server
utopia build            # production build
utopia preview          # preview production build
utopia test             # run tests (vitest)
utopia mcp install      # register MCP server with Claude Code
```

All commands accept `--port`, `--host`, `--open`, `--outDir`, `-c <config>`.

## .utopia file format

Single-file components with three optional blocks:

```html
<template>
  <div class="counter">
    <p>count: {{ count() }}</p>
    <button @click="increment">+1</button>
  </div>
</template>

<script lang="ts">
import { signal } from '@matthesketh/utopia-core'

const count = signal(0)

function increment() {
  count.update(n => n + 1)
}
</script>

<style>
.counter {
  font-family: system-ui;
  padding: 1rem;
}
</style>
```

- `<template>` — HTML with reactive bindings (`{{ }}`, `@event`, `:attr`, `u-if`, `u-for`)
- `<script>` — component logic; add `lang="ts"` for TypeScript
- `<style>` — scoped CSS extracted via the Vite plugin

## signals example

```ts
import { signal, computed, effect } from '@matthesketh/utopia-core'

const count = signal(0)
const double = computed(() => count() * 2)

const dispose = effect(() => {
  console.log('double is', double())
})

count.set(5)   // logs "double is 10"
dispose()      // stop the effect
```
