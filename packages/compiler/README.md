# @utopia/compiler

Compiler for `.utopia` single-file components. Parses SFC blocks (template, script, style), compiles templates to direct DOM operations, and applies scoped CSS.

## Install

```bash
pnpm add @utopia/compiler
```

## Usage

```ts
import { compile } from '@utopia/compiler';

const source = `
<template>
  <div>{{ count() }}</div>
</template>

<script>
import { signal } from '@utopia/core'
const count = signal(0)
</script>

<style scoped>
div { color: blue; }
</style>
`;

const { code, css } = compile(source, { filename: 'Counter.utopia' });
// code: compiled JS module with render function
// css:  scoped CSS with data attributes
```

## API

| Export | Description |
|--------|-------------|
| `compile(source, options?)` | Compile a `.utopia` SFC source string to `{ code, css }`. |
| `parse(source, filename?)` | Parse SFC into a descriptor with template, script, and style blocks. |
| `compileTemplate(source, options?)` | Compile a template string to a render function module. |
| `compileStyle(options)` | Compile and scope CSS with data attribute selectors. |
| `generateScopeId(filename)` | Generate a deterministic scope ID from a filename. |

See [docs/architecture.md](../../docs/architecture.md) for the full compilation pipeline.

## License

MIT
