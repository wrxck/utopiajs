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
| `utopia/no-undecoded-entities` | Flags named HTML entities in the `<template>` that the Utopia compiler does not decode (e.g. `&middot;`, `&minus;`), since they would render as literal text. Numeric references (`&#183;`) and the literal character are always safe. |
