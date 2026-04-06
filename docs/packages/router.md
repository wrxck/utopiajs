# @matthesketh/utopia-router

File-based client-side router using the History API. Route state is exposed as reactive signals.

## install

```bash
npm install @matthesketh/utopia-router
```

## file-based routing conventions

Place route files under `src/routes/`:

```
src/routes/
  +page.utopia          # /
  +layout.utopia        # layout wrapping all child routes
  about/
    +page.utopia        # /about
  blog/
    +page.utopia        # /blog
    +layout.utopia      # layout wrapping /blog routes
    [slug]/
      +page.utopia      # /blog/:slug
  +error.utopia         # error boundary
```

Special filenames:

| file | purpose |
|---|---|
| `+page.utopia` | page component |
| `+layout.utopia` | layout wrapper |
| `+error.utopia` | error boundary |
| `+server.ts` | API route handler |

Dynamic segments use `[param]` directory names.

## createRouter()

Initialize the router with a route table. Typically called once in `main.ts`.

```ts
import { createRouter } from '@matthesketh/utopia-router'
import routes from 'virtual:utopia-routes'

createRouter(routes)
```

## navigate()

Programmatic navigation.

```ts
import { navigate } from '@matthesketh/utopia-router'

navigate('/blog/hello-world')
navigate('/search?q=test')
```

## back() / forward()

```ts
import { back, forward } from '@matthesketh/utopia-router'

back()
forward()
```

## currentRoute / isNavigating

Reactive signals for the current route state.

```ts
import { currentRoute, isNavigating } from '@matthesketh/utopia-router'

currentRoute()    // RouteMatch | null
isNavigating()    // boolean
```

## route params

```ts
import { getRouteParam, queryParams, getQueryParam } from '@matthesketh/utopia-router'

getRouteParam('slug')          // string | undefined — from /blog/[slug]
getQueryParam('q')             // string | undefined — from ?q=value
queryParams()                  // Record<string, string> — all query params
```

```ts
import { setQueryParam, setQueryParams } from '@matthesketh/utopia-router'

setQueryParam('page', '2')
setQueryParams({ q: 'hello', page: '1' })
```

## createRouterView / createLink

Render helpers returned from the components module.

```ts
import { createRouterView, createLink } from '@matthesketh/utopia-router'
```

## beforeNavigate()

Navigation guard. Return `false` to cancel, a string to redirect, or `void`/`true` to allow.

```ts
import { beforeNavigate } from '@matthesketh/utopia-router'

beforeNavigate((from, to) => {
  if (!isLoggedIn() && to?.route.path.startsWith('/dashboard')) {
    return '/login'
  }
})
```

## preloadRoute()

Eagerly load a route's component to warm the cache.

```ts
import { preloadRoute } from '@matthesketh/utopia-router'

preloadRoute('/blog/hello-world')
```
