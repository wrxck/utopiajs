# @matthesketh/utopia-vite-plugin

Vite plugin for UtopiaJS. Transforms `.utopia` single-file components, extracts and injects CSS through Vite's virtual module pipeline, provides granular HMR support (style-only hot updates), and handles the SSR runtime swap.

## Install

```bash
pnpm add -D @matthesketh/utopia-vite-plugin
```

Requires `vite` ^6.0.0 or ^7.0.0 as a peer dependency.

## Usage

```ts
// vite.config.ts
import { defineConfig } from '@matthesketh/utopia-vite-plugin';

export default defineConfig();
```

Or with the plugin directly:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import utopia from '@matthesketh/utopia-vite-plugin';

export default defineConfig({
  plugins: [utopia()],
});
```

## API

| Export | Description |
|--------|-------------|
| `default (utopiaPlugin)` | The Vite plugin factory. Accepts `UtopiaPluginOptions`. |
| `defineConfig(userConfig?)` | Create a Vite config pre-configured for UtopiaJS (plugin, extensions, SSR settings). |

**UtopiaPluginOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `include` | `FilterPattern` | `'**/*.utopia'` | Glob patterns to include |
| `exclude` | `FilterPattern` | -- | Glob patterns to exclude |
| `fragments` | `boolean` | `false` | Compile multi-root templates, multi-child slot content and empty templates to real DOM fragments instead of wrapper `<div>`s. Opt-in because removing the wrapper changes DOM shape (flex/grid parenting, root-level scoped selectors). Not yet supported with hydration. |

**Features:**

- Compiles `.utopia` files via `@matthesketh/utopia-compiler`
- Extracts CSS to virtual modules processed by Vite's CSS pipeline
- Granular HMR: style-only changes skip component re-render
- SSR alias: swaps `@matthesketh/utopia-runtime` to `@matthesketh/utopia-server/ssr-runtime` in SSR builds and dev SSR, and bundles every `@matthesketh/utopia-*` package into the server build so their own runtime imports reach the swap
- Server transforms carry each component's CSS on its definition (`emitStyles`), so `renderToString` and email rendering collect it
- `virtual:utopia-routes` globs `+server` API modules into server builds only
- Resolves `.utopia` as a file extension for bare imports

**Types:** reference the ambient declarations for `virtual:utopia-routes` and
`*.utopia` imports once, e.g. in `src/env.d.ts`:

```ts
/// <reference types="@matthesketh/utopia-vite-plugin/client" />
```

See [docs/architecture.md](../../docs/architecture.md) and [docs/ssr.md](../../docs/ssr.md) for details.

## License

MIT
