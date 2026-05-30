# @matthesketh/prettier-plugin-utopia

A [Prettier](https://prettier.io) plugin for [UtopiaJS](https://github.com/wrxck/utopiajs) `.utopia` single-file components.

The plugin splits a component into its top-level blocks and hands each block's body to Prettier's own well-tested formatter:

- `<template>` → the `html` formatter (directives such as `:bind`, `@on`, `u-for` and `{{ }}` interpolations are preserved verbatim);
- `<script>` / `<test>` → the `typescript` formatter;
- `<style>` → `css`, or `scss` / `less` when `lang` says so.

Blocks are kept in source order, separated by a blank line. Formatting is idempotent, and a block Prettier cannot parse is left untouched (only re-indented) rather than failing the whole file.

## Install

```sh
pnpm add -D prettier @matthesketh/prettier-plugin-utopia
```

`prettier` (>= 3) is a peer dependency.

## Usage

```json
// .prettierrc
{
  "plugins": ["@matthesketh/prettier-plugin-utopia"]
}
```

Then `prettier --write '**/*.utopia'`.
