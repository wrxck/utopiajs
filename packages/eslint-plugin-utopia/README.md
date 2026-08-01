# @matthesketh/eslint-plugin-utopia

ESLint parser and rules for [UtopiaJS](https://github.com/wrxck/utopiajs) `.utopia` single-file components.

The plugin ships a custom parser that lints the `<script>` block as real TypeScript — full type-aware AST, scope analysis and accurate line/column reporting — by masking everything outside the script to whitespace before delegating to `@typescript-eslint/parser`. Template-level rules read the raw component source, so positions are exact.

## Install

```sh
pnpm add -D eslint @matthesketh/eslint-plugin-utopia
```

`eslint` (>= 9) is a peer dependency.

## Usage (flat config)

```js
// eslint.config.js
import utopia from '@matthesketh/eslint-plugin-utopia';

export default [...utopia.configs.recommended];
```

The recommended config targets `**/*.utopia`, wires up the parser, and enables the rules below. Add your own `@typescript-eslint` rules in the same block to apply them to the script body.

## Rules

| Rule | Description |
| --- | --- |
| `utopia/no-tdz-effect-read` | Flags a top-level `effect()` whose callback reads a module-scope `const`/`let`/`class` declared **below** it. `effect()` runs its callback immediately, so the read hits the temporal dead zone and throws while the module is still evaluating — and because a body that throws before its first signal read captures no dependencies, the effect is left subscribed to nothing and silently never fires again. |
| `utopia/no-undecoded-entities` | Flags named HTML entities in the `<template>` that the Utopia compiler does not decode (e.g. `&middot;`, `&minus;`), since they would render as literal text. Numeric references (`&#183;`) and the literal character are always safe. |
| `utopia/no-untracked-global-listener` | Flags a `window`/`document`/`globalThis` `addEventListener` in a `defineProps()` component that nothing removes. Those components get a per-instance `setup()`, so the listener is registered again on every mount and accumulates. Use `useEventListener()` from `@matthesketh/utopia-runtime`, pair it with `removeEventListener()` in `onDestroy()`, or pass `{ once: true }` / `{ signal }`. |
