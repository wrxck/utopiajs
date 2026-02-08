# @matthesketh/utopia-router

File-based routing for UtopiaJS with History API, navigation guards, and reactive route state. SvelteKit-style file conventions (`+page.utopia`, `+layout.utopia`, `[param]`, `[...rest]`, `(group)`).

## Install

```bash
pnpm add @matthesketh/utopia-router
```

## Usage

```ts
import { createRouter, currentRoute, navigate } from '@matthesketh/utopia-router';
import { buildRouteTable } from '@matthesketh/utopia-router';

const routes = buildRouteTable(routeManifest);
createRouter(routes);

// Reactive route state
console.log(currentRoute().pathname);

// Programmatic navigation
navigate('/about');
```

## File Conventions

| File Path | URL Pattern |
|-----------|-------------|
| `src/routes/+page.utopia` | `/` |
| `src/routes/about/+page.utopia` | `/about` |
| `src/routes/blog/[slug]/+page.utopia` | `/blog/:slug` |
| `src/routes/[...rest]/+page.utopia` | `/*rest` (catch-all) |
| `src/routes/(auth)/login/+page.utopia` | `/login` (route group) |
| `src/routes/+layout.utopia` | Layout wrapper |
| `src/routes/+error.utopia` | Error boundary |

## API

**Route matching:**

| Export | Description |
|--------|-------------|
| `filePathToRoute(path)` | Convert a file path to a route pattern |
| `compilePattern(pattern)` | Compile a route pattern to a regex matcher |
| `matchRoute(routes, url)` | Match a URL against a route table |
| `buildRouteTable(manifest)` | Build a route table from a file manifest |

**Client-side router:**

| Export | Description |
|--------|-------------|
| `createRouter(routes)` | Initialize the client router |
| `navigate(url)` | Programmatic navigation |
| `back()` | Go back in history |
| `forward()` | Go forward in history |
| `beforeNavigate(hook)` | Register a navigation guard |
| `destroy()` | Tear down the router |
| `currentRoute` | Reactive signal with the current route |
| `isNavigating` | Reactive signal indicating navigation in progress |

**Components:**

| Export | Description |
|--------|-------------|
| `createRouterView()` | Render the matched route component |
| `createLink(props)` | Create a client-side navigation link |

See [docs/architecture.md](../../docs/architecture.md) for full routing details.

## License

MIT
