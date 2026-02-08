# @matthesketh/utopia-vite-plugin

Vite plugin for UtopiaJS. Transforms `.utopia` single-file components, extracts and injects CSS through Vite's virtual module pipeline, provides granular HMR support (style-only hot updates), and handles the SSR runtime swap.

## Install

```bash
pnpm add -D @matthesketh/utopia-vite-plugin
```

Requires `vite` ^6.0.0 as a peer dependency.

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
| `sourceMap` | `boolean` | `true` (dev) | Generate source maps |

**Features:**

- Compiles `.utopia` files via `@matthesketh/utopia-compiler`
- Extracts CSS to virtual modules processed by Vite's CSS pipeline
- Granular HMR: style-only changes skip component re-render
- SSR alias: swaps `@matthesketh/utopia-runtime` to `@matthesketh/utopia-server/ssr-runtime` in SSR builds and dev SSR
- Resolves `.utopia` as a file extension for bare imports

See [docs/architecture.md](../../docs/architecture.md) and [docs/ssr.md](../../docs/ssr.md) for details.

## License

MIT
