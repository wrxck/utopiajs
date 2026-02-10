# UtopiaJS

A compiler-first, signal-based UI framework with single-file components.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220.svg)](https://pnpm.io/)

## Overview

UtopiaJS compiles `.utopia` single-file components to direct DOM operations — no virtual DOM at runtime. Fine-grained signals drive reactivity, file-based routing handles navigation, and a runtime-swap architecture enables server-side rendering with cursor-based hydration. The framework also includes template-based email rendering, AI adapters with MCP (Model Context Protocol) support, and a Vite plugin with HMR.

## Quick Start

```bash
npx create-utopia my-app
cd my-app
pnpm install
pnpm dev
```

## Features

- **Fine-grained signals reactivity** — `signal()`, `computed()`, `effect()`, `batch()`, `untrack()`
- **Single-file `.utopia` components** — template + script + scoped style in one file
- **Compiler-first** — templates compile to direct DOM operations, no virtual DOM
- **SvelteKit-style file-based routing** — `+page.utopia`, `+layout.utopia`, `[param]`, `[...rest]`, `(group)`
- **Server-side rendering** with cursor-based hydration
- **Template-based email** with SMTP, Resend, and SendGrid adapters
- **AI integration** with OpenAI, Anthropic, Google, and Ollama adapters
- **MCP (Model Context Protocol)** server and client
- **Vite plugin** with HMR and SSR alias resolution
- **TypeScript by default**

## Packages

| Package | Description |
|---------|-------------|
| `@matthesketh/utopia-core` | Signals reactivity system |
| `@matthesketh/utopia-compiler` | SFC parser + template compiler + scoped CSS |
| `@matthesketh/utopia-runtime` | DOM helpers, directives, component lifecycle, scheduler, hydration |
| `@matthesketh/utopia-server` | SSR: renderToString, renderToStream, server router, handler |
| `@matthesketh/utopia-vite-plugin` | Vite transform for .utopia files, HMR, SSR alias resolution |
| `@matthesketh/utopia-router` | File-based routing with History API, navigation guards |
| `@matthesketh/utopia-email` | Template-based email rendering with adapter pattern |
| `@matthesketh/utopia-ai` | AI adapters (OpenAI, Anthropic, Google, Ollama) + MCP |
| `@matthesketh/utopia-cli` | CLI tool: `utopia dev`, `utopia build`, `utopia preview` |
| `create-utopia` | CLI scaffolding tool (`npx create-utopia`) |

## Example

A minimal `.utopia` component using signals:

```html
<template>
  <div>
    <h1>Count: {{ count() }}</h1>
    <button @click="increment">+1</button>
  </div>
</template>

<script>
import { signal } from '@matthesketh/utopia-core'

const count = signal(0)
function increment() { count.update(n => n + 1) }
</script>

<style scoped>
h1 { color: #333; }
</style>
```

The compiler transforms this into direct DOM operations with reactive `createEffect()` bindings — no diffing, no virtual DOM.

## Documentation

- [Architecture](docs/architecture.md) — compilation pipeline, reactivity system, directives, routing
- [Server-Side Rendering](docs/ssr.md) — runtime swap, hydration, VNode types, API reference
- [AI & MCP](docs/ai.md) — AI adapters, tool calling, MCP server/client, streaming
- [Email](docs/email.md) — email rendering, SMTP/Resend/SendGrid adapters, components

## Development

```bash
git clone https://github.com/wrxck/utopiajs.git
cd utopiajs
pnpm install
pnpm build
pnpm test
```

This is a pnpm monorepo. All packages live under `packages/` and are linked automatically via `pnpm-workspace.yaml`.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. All changes should include tests and follow the existing code patterns.

## License

[MIT](LICENSE)
