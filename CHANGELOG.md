# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.1] - 2026-08-01

A single-defect patch. `@matthesketh/prettier-plugin-utopia` could silently
delete part of a component's `<script>` block, and the damage survived every
check that would normally catch it.

### Fixed

- `@matthesketh/prettier-plugin-utopia` — **formatting could destroy source.**
  The block splitter counted `<script>` tags by scanning text, so any token
  that looked like an opening tag but was not one raised the depth count with
  nothing to unwind it. The commonest trigger is the literal text `<script>`
  inside an ordinary `//` comment; the mandatory `<\/script>` escape inside a
  string literal, and an unclosed block, do it too. The block's opening lines —
  every import and declaration above the comment — were dropped, and the
  remnant of the comment line was left as a bare `is;` statement. The wreckage
  is valid TypeScript, so nothing failed; it is also idempotent, so a
  fixed-point check passes on an already-ruined file.

  Fixed in three places, so no single miscount can delete source again:
  `findBlockEnd` falls back to the first closing tag when the depth cannot
  unwind, which is where the compiler's parser ends the block too, so the
  formatter and the compiler always agree; the parser refuses any file its
  blocks do not fully span; and the printer repeats that check against
  prettier's own copy of the file, since the printer is where the loss would
  actually happen. An unclosed block is now refused rather than emptied.

### Changed

- All packages bumped to 0.13.1, as the lockstep convention requires. Only the
  prettier plugin's shipped code changed; the other fifteen carry the
  repository-wide lint and format pass, which is source-level only — their
  built output differs from 0.13.0 by import ordering and chunk hashes alone.

## [0.13.0] - 2026-08-01

A quality release. The bulk of it is the repository-wide review in #39 — 56
bugs, each proven by a failing test written before the fix, plus a coverage
push from ~66% to ~100% (1009 tests to 1923). No public API changes. Alongside
it, three defects that the review surfaced in code it could not itself reach,
because it branched before the 0.9.0-0.12.0 wave.

### Fixed

- `@matthesketh/utopia-compiler` — **a static attribute value spanning lines
  emitted an invalid module.** `escapeStr` escaped backslashes and quotes but
  not line breaks, so a raw newline landed inside a single-quoted JS string
  literal and the emitted render module failed to parse.
- `@matthesketh/utopia-compiler` — **a structural directive inside a component
  slot crashed at render.** The slot body is generated into a closure, but the
  deferred `createIf`/`createFor` call it produces was flushed into the
  surrounding function, where the closure's variables are not in scope — every
  such component threw a `ReferenceError`. The slot body now gets its own
  deferred frame, the same way conditional branches already did.
- `@matthesketh/utopia-runtime` — **a root-level `u-for` rendered nothing.**
  `createFor`'s first reconcile runs before the caller has attached the
  anchor; it returned early instead of retrying, so unless the list happened to
  change again later the rows never appeared at all. It now retries on a
  microtask once the anchor has a parent, matching `createIf`. This also
  covers a `u-for` used as a branch of a `u-else-if` chain.
- Roughly 56 further fixes across `ai`, `content`, `email`, `router`, `server`,
  `runtime`, `core`, `cli`, `create-utopia`, `vite-plugin`, `test` and the
  prettier plugin — among them: the resend adapter reporting failed sends as
  success, a lazy-init race duplicating SMTP pools, the router's same-origin
  check being fooled by `http://origin.evil.com`, API route handlers receiving
  requests with no headers or body, streamed renders leaking head entries,
  leaked AI stream readers, `.yml` content entries being unreadable, and the
  formatter truncating templates that contain a native `<template>` element.
  See PR #39 for the full list.

### Changed

- `renderToStream` honours backpressure (output asserted byte-identical to
  `renderToString`).
- CI builds the workspace before linting, since the workspace eslint and
  prettier plugins load from `dist/`.
- All packages bumped to 0.13.0.

## [0.12.0] - 2026-07-27

Every package moves to 0.12.0 together. The versions had drifted three ways
(most at 0.8.2, the core group at 0.9.0, the vite plugin at 0.11.0 with two
feature releases that never reached npm), which made "which versions work
together" a question nobody could answer from the registry. From here the answer
is: the same one.

### Added

- **New package: `@matthesketh/utopia-ts-plugin`** — a TypeScript
  language-service plugin that puts `.utopia` components into the compilation,
  so moving or renaming a module in the editor updates the imports inside
  components instead of silently rotting them. Without it a `.utopia` file is
  invisible to TypeScript and every such import is left behind by a rename.
  It masks everything outside the `<script>` block to whitespace and hands the
  result to the language service — the same technique
  `@matthesketh/eslint-plugin-utopia` uses. Because the masked text is the same
  length as the file, every offset, line and column maps by identity, so the
  edits that come back apply to the `.utopia` file unchanged. Opt in via
  `compilerOptions.plugins` in `tsconfig.json`; `typescript` is a peer
  dependency and the editor must use the workspace TypeScript version, since
  plugins only load in the version that owns them.
- `@matthesketh/eslint-plugin-utopia` — **two rules for traps the type checker
  cannot see**, both `error` in `recommended`.
  `no-tdz-effect-read` flags a top-level `effect()` whose body references a
  module-scope binding declared *below* it. That is a temporal dead zone error
  at registration, and because an effect that throws before reading a signal
  loses its dependencies, it leaves the effect permanently dead rather than
  merely erroring once. Built on scope analysis rather than name matching, so a
  shadowed name or a property key of the same name does not false-positive; a
  reference inside a nested closure (a returned cleanup, a `setTimeout`) is
  skipped, since it does not run at registration.
  `no-untracked-global-listener` flags `window`/`document`/`globalThis`
  `addEventListener` inside a component that calls `defineProps()`. The compiler
  wraps such a script in a per-instance setup function called on every node
  creation, and teardown only disposes what went through `pushDisposer` /
  `onDestroy` — so the listener is registered again on every mount and never
  removed. `{ once: true }` and `{ signal }` are exempt.
- `@matthesketh/utopia-vite-plugin` (0.11.0) — **compile-time template fragments
  via `<include src>`**. `<include src="./part.uhtml" />` inside a `<template>`
  splices the referenced fragment in place *before* compilation, so it is
  compiled into the parent's own render function against the parent's script
  scope — no component boundary. Rendering and reactivity are byte-for-byte
  identical to writing the markup inline (a test asserts this), which is what
  makes it safe to pull repeated or bulky markup out of a `.utopia` file, or
  share a fragment across pages, with zero behaviour change — unlike a child
  component, which introduces its own render/effect scope and remount. Includes
  nest (resolved relative to each fragment), a cycle throws, a missing file
  fails the build, and editing a fragment hot-updates every component that pulls
  it in.
- `@matthesketh/utopia-vite-plugin` (0.10.0) — **external component stylesheets
  via `<style src>`**. A component may now keep its CSS in a sibling file and
  pull it in with `<style src="./thing.css" scoped>`; the plugin reads the file
  and splices it into the block before compilation, so the filename-seeded scope
  id makes it scoped byte-for-byte identically to the same rules written in
  place. Editing the external stylesheet hot-updates every component that imports
  it (style-only, no re-render), the file is registered as a watched build input,
  and a missing file fails the build with a clear error. Lets large components
  shed their `<style>` block without any change to the runtime or the emitted
  CSS.
- `@matthesketh/utopia-compiler` (0.9.0) — opt-in **per-instance components with
  props**. A component whose `<script>` calls `defineProps()` is compiled into a
  `setup(props)` factory (script + render nested inside, user imports hoisted to
  module scope) and exported as `{ setup, render }`; components that do not call
  `defineProps()` keep the exact module-scope output, so existing components
  compile byte-for-byte identically. Props are passed as values — reactivity is
  achieved the idiomatic way, by passing a signal uncalled (`:foo="sig"`) and
  reading it with `foo()` in the child. `defineProps()` takes no arguments and no
  type parameter (type the result with a cast: `const { x } = defineProps() as T`).
- `@matthesketh/utopia-runtime` (0.9.0) — **`provide()` / `inject()` context**.
  `provide(key, value)` during a component's `setup()` makes a value available to
  that component and all descendants; `inject(key, fallback?)` reads the nearest
  ancestor's value (or the fallback). Keys are any stable value (typically a
  module-level symbol). Lets you share state down a subtree without prop-drilling
  or module-level singletons. Each `createComponent` (and root `mount`) pushes an
  owner around `setup` + `render`, so children created during render link to their
  parent for the upward `inject()` walk.
- **`u-model` now works for every control kind.** The compiler emits a single
  `applyModel(el, signal, opts)` call that inspects the element at runtime and
  wires the correct property + event for text inputs, `<textarea>`, `<select>`,
  checkboxes (boolean), radios (selected value), and number/range inputs.
  Modifiers `u-model.number` (coerce to number, also implied by `type=number`),
  `.trim`, and `.lazy` (sync on `change` instead of `input`) are supported.
- **`u-show` directive.** Toggles an element's visibility in place (via `display`)
  instead of adding/removing it from the DOM like `u-if`. The element — and any
  costly native state it holds (a live `<video>` `MediaStream`, a `<canvas>`'s
  pixels, input focus, scroll position) — stays mounted across the toggle, so it
  is the right primitive for anything expensive to recreate. The element's own
  display is stashed so showing restores exactly what the author set (inline value
  or stylesheet default). Compiles to a `setShow(el, () => expr)` runtime helper;
  SSR bakes `display: none` into the initial markup when hidden. Motivated by a
  barcode-scanner feed that went black every time a `u-if` sibling re-rendered.
- **Array `:class` / `:style` bindings.** `:class` and `:style` now accept arrays
  (including nested arrays and a mix of strings/objects) in addition to the
  string and object forms they already supported — e.g. `:class="['chip', { on:
  active() }]"`. Exposed as `normalizeClass()` / `normalizeStyle()` runtime
  helpers.
- **Component `@event` handlers.** `<Child @select="handler" />` now compiles to
  an `onSelect` callback prop the child can invoke (previously `@event` on a
  component was silently dropped). Hyphenated names are camelCased
  (`@select-item` → `onSelectItem`); inline expressions are wrapped so `$event`
  is the payload the child passes.
- `@matthesketh/utopia-core` (0.9.0) — **`createRoot(fn)`** owns every `effect`
  and `computed` created during its synchronous execution and hands back a
  `dispose` that tears them all down at once; roots nest. **`computed().dispose()`**
  unsubscribes a derived signal from its sources (freezing it at its last value)
  so a long-lived source no longer retains it.

### Fixed

- `@matthesketh/utopia-core` — **an effect that threw before reading a signal was
  left permanently dead.** `_run()` unsubscribes from every dependency *before*
  invoking the body, and an error is reported rather than rethrown — so a body
  that threw early ended up subscribed to nothing while still alive. Nothing
  could ever notify it again, silently, for the lifetime of the page. The
  dependency set is now snapshotted and restored when a run throws having
  captured none. A run that threw *after* reading some signals keeps its partial
  set, because that is indistinguishable from a conditional branch that stopped
  reading — and a *successful* run that captured nothing is an effect opting out
  of tracking, not an orphan. Note this cannot rescue a throw on the FIRST run
  (there is nothing to restore); that case is preventable only, which is what
  `no-tdz-effect-read` below is for.
- `@matthesketh/utopia-core` — **a runaway effect cascade outside a batch ran
  unbounded and silently.** The existing flush guard only covers the batched
  path, so a synchronous re-entrant cascade had no ceiling and no error — it
  simply consumed the main thread. `_run()` now carries a depth guard at the
  same limit as the flush and compute guards. It measures depth, not total runs,
  so a flush executing a thousand sibling effects never trips it, and the
  threshold is set so the existing flush guard still fires first on a cyclic
  cascade. A cascade re-entered across ticks is a *rate* problem rather than a
  depth one and is deliberately not covered.
- `@matthesketh/utopia-compiler` + `@matthesketh/utopia-runtime` +
  `@matthesketh/utopia-server` — **the `u-for` loop variable is now reactive**, so
  a reused keyed row updates its bindings instead of rendering the item it was
  first given. `:key` deliberately keeps a row across a list update, and because
  keys are usually `item.id`, the canonical immutable update
  (`items.map(x => ({ ...x, name }))`) arrived as a new object under an existing
  key — a row whose bindings had closed over the first object showed it forever
  (and a `@click` handler fired on it). `createFor` now hands each row a scope:
  it rebinds the row's loop variables and bumps a per-row version cell, and the
  codegen calls that scope's `track()` in front of every expression the runtime
  evaluates inside an effect (interpolations, `:bindings`, `u-if`, `u-show`,
  `u-html`, and a nested `u-for`'s list expression). Template syntax is
  unchanged — `item.name`, `(item, index)`, `:key="item.id"` and
  `@click="() => f(item)"` all keep working, and a handler now acts on the item
  its row currently shows. The row's DOM node is still reused, so focus, caret
  and scroll position survive; `:key` keeps its Vue-like semantics rather than
  becoming referential. A `renderItem` written by hand (or emitted by an older
  compiler) ignores the third argument and behaves exactly as before, SSR passes
  an inert scope so server markup is byte-for-byte unchanged, and a template
  with no `u-for` compiles to identical output.
- `@matthesketh/utopia-runtime` (0.9.0) — effect disposers created during a
  per-instance `setup()` (via `createEffect`/`use*`) are now captured and torn
  down when the instance unmounts. Previously the disposer window only wrapped
  `render`, so setup-phase effects leaked. The lifecycle window stays scoped to
  `setup`, so child components mounted during `render` never clobber it.
- `@matthesketh/utopia-runtime` (0.9.0) — `createForm().handleSubmit(fn)` now
  reads each field's value directly from the form's field map rather than via
  `this.data()`, so a destructured `const { handleSubmit } = createForm(...)`
  no longer throws on submit.
- `@matthesketh/utopia-runtime` + `@matthesketh/utopia-compiler` — `u-else-if`
  chains now generate and run correctly: each branch's nested `createIf` is
  emitted inside its own branch closure, and `createIf` retries on a microtask
  when its anchor is not yet connected (the case for a branch returned into an
  outer `createIf`).
- `@matthesketh/utopia-router` (0.9.0) — route pages that use `defineProps`
  (i.e. compile to `{ setup, render }`) now render correctly: the router calls
  `setup(props)` and renders with the resulting context instead of calling
  `render(props)` directly (which crashed). Route rendering is also wrapped so
  the page's effects, computeds (e.g. from `getQueryParam`/`getRouteParam`),
  `onDestroy` hooks, and child-component teardown all run on navigation instead
  of leaking against the long-lived router signals. `provide()` during a route
  page's setup now resolves for its descendants.

### Tooling

- Added `eslint-plugin-simple-import-sort` to the lint config so `npm run lint`
  / `lint:fix` / `format` organise imports into stable groups (side-effect, node
  builtins, external, `@/` alias, then relative).
- All library-internal imports across the packages now use the `@/` alias
  (`@/component`) instead of relative paths, resolved per-package via tsconfig
  `paths` and a matching resolver in the vitest config. The published bundles are
  unaffected — tsup inlines the alias, so no `@/` specifiers appear in any
  `dist` `.js` or `.d.ts`.

## [0.8.1] - 2026-05-29

Follow-up hardening on top of 0.8.0.

### Security

- `@matthesketh/utopia-ai` — the SSE and Ollama stream parsers now cap their
  unflushed buffer, so an upstream that sends a large amount of data with no
  line delimiter can no longer exhaust memory.
- `@matthesketh/utopia-ai` — the Ollama, OpenAI and Anthropic adapters validate
  that a configured `baseURL` is `http(s)` (rejecting `file:` and other
  schemes). The `onError` hook is documented as receiving sensitive request
  context that must not be logged verbatim.

### Performance

- `@matthesketh/utopia-runtime` — `createFor` now keys primitive lists by value
  rather than by index, so reordering a list of primitives reuses and moves the
  existing nodes instead of rebuilding the tail.

### Changed

- All packages bumped to 0.8.1.

## [0.8.0] - 2026-05-29

A security- and performance-focused release. The headline change is keyed
reconciliation in `createFor`; alongside it this release closes a set of XSS,
injection, SSRF and memory-safety issues across the framework and adds
regression tests for each. All relative import specifiers now omit the `.js`
extension (the workspace already resolves modules via the bundler).

### Security

- `@matthesketh/utopia-runtime` / `@matthesketh/utopia-server` — `setAttr` now
  blocks `javascript:`/`vbscript:` (and unsafe `data:`) URLs on URL-bearing
  attributes and refuses to bind inline `on*` event-handler attributes, so a
  bound user value can no longer become a DOM-XSS sink. `data:image/…` (and
  audio/video/font) remain allowed on `src`/`poster`.
- `@matthesketh/utopia-runtime` — the client HTML sanitiser now drops
  `<script>`/`<style>`/`<iframe>` and other dangerous subtrees entirely
  (matching the server sanitiser) and adds `rel="noopener noreferrer"` to
  `target="_blank"` links.
- `@matthesketh/utopia-content` — AMP pages now run `entry.html` through the
  allowlist sanitiser instead of a bypassable regex script-strip; JSON-LD output
  escapes `<`/`>`/`&` and the line/paragraph separators to prevent `</script>`
  breakout; frontmatter parsing strips `__proto__`/`constructor`/`prototype`
  keys.
- `@matthesketh/utopia-content` — the filesystem adapter resolves symlinks and
  uses a path-separator boundary check so reads/writes/deletes cannot escape the
  content root, and validates the slug on `updateEntry`/`deleteEntry`.
- `@matthesketh/utopia-ai` — the MCP HTTP handler gains an `authorize` gate and
  an `allowedOrigins` allow-list (DNS-rebinding defence); the MCP server
  validates JSON-RPC params and tool arguments against the declared schema and
  no longer echoes raw handler exceptions to callers; the MCP client rejects
  non-`http(s)` endpoints and no longer follows redirects (preventing
  credential leakage to a redirect target).
- `@matthesketh/utopia-email` — the mailer rejects CR/LF in recipient/subject/
  header fields (header-injection defence).
- `@matthesketh/utopia-server` — the SSR handler injects rendered markup with a
  replacer function (so `$`-sequences are literal), validates API response
  status codes, dispatches API routes only to own allow-listed methods, returns
  400 (not 500) on malformed percent-encoding, and emits baseline security
  headers plus an opt-in `csp`.
- `@matthesketh/utopia-router` — same-origin guard applied on the `popstate`
  redirect path and protocol-relative links rejected; route matching tolerates
  malformed percent-encoding.
- `@matthesketh/utopia-helmet` — descriptor values are escaped before being
  interpolated into a `querySelector`.

### Fixed

- `@matthesketh/utopia-runtime` — child components mounted via `createComponent`
  now have their effects disposed and `onDestroy` run when their parent
  unmounts or their list row is removed; `createIf` disposes branch bindings on
  toggle and tears down on unmount; `setHtml`/`setSafeHtml` register their
  effects for disposal; lazy components clean up on unmount. These close a set
  of memory leaks on unmount/toggle/list-removal.
- `@matthesketh/utopia-email` — fixed catastrophic backtracking (ReDoS) in the
  CSS-inliner tag regexes.

### Performance

- `@matthesketh/utopia-content` — the markdown processor is built once and
  reused; parsed entries are cached by path + mtime, avoiding repeated disk
  reads, frontmatter parsing and markdown rendering.
- `@matthesketh/utopia-server` — SSR serialisation builds output in a single
  buffer (was quadratic) and validates each tag once.
- `@matthesketh/utopia-runtime` / `@matthesketh/utopia-server` — hoisted
  per-call allocations out of `setAttr`.

### Changed

- All packages bumped to 0.8.0.
- Relative imports no longer use `.js` extensions.

## [0.7.0] - 2026-03-16

### Added

- `@matthesketh/utopia-runtime` — `createErrorBoundary()` for graceful error handling with fallback UI
- `@matthesketh/utopia-runtime` — `useHead()` for reactive document head management (title, meta, link tags)
- `@matthesketh/utopia-runtime` — `defineLazy()` for code-split components with async loading
- `@matthesketh/utopia-runtime` — `createTransition()` with `performEnter`/`performLeave` for CSS transition animations
- `@matthesketh/utopia-server` — `serializeHead()` for SSR head injection (title, meta, links into HTML)
- `@matthesketh/utopia-server` — `buildApiRoutes()`/`handleApiRequest()` for file-based API route handlers
- `@matthesketh/utopia-vite-plugin` — `client.d.ts` type declarations for .utopia file imports
- `create-utopia` — Updated scaffolding template with smoke tests
- 759 tests passing across 22 test files

### Fixed

- CI: override rollup to >=4.59.0 to resolve CVE-2025-46838
- CI: add compiler alias to vitest config, audit prod deps only

### Changed

- `@matthesketh/utopia-server` — hardened SSR runtime with additional safety checks
- `@matthesketh/utopia-compiler` — improved template compilation output

## [0.6.0] - 2026-03-02

### Added

- **New package: `@matthesketh/utopia-content`** — type-safe content collections with markdown pipeline
- `@matthesketh/utopia-content` — `defineCollection()`/`getCollection()`/`getEntry()` API with schema validation
- `@matthesketh/utopia-content` — Markdown rendering via unified/remark/rehype with syntax highlighting
- `@matthesketh/utopia-content` — Filesystem adapter supporting `.md`, `.utopia`, `.json`, `.yaml` formats
- `@matthesketh/utopia-content` — MCP content server with 9 tools (list/get/create/update/delete/search/tags/publish)
- `@matthesketh/utopia-content` — MCP resources for `content://{collection}` and `content://{collection}/{slug}`
- `@matthesketh/utopia-content` — Vite plugin with HMR and `virtual:utopia-content` manifest module
- `create-utopia` — Blog template option in scaffolding
- Documentation: `docs/content.md` for content collections and blog setup
- 700 tests passing across 20 test files

### Fixed

- `@matthesketh/utopia-router` — eliminated flash of empty content on initial page load via `preloadRoute()` module cache

## [0.5.0] - 2026-02-11

### Added

- **New package: `@matthesketh/utopia-test`** — component testing utilities
- `@matthesketh/utopia-test` — `mount()`, `render()`, `fireEvent`, `nextTick` test helpers
- `@matthesketh/utopia-test` — Vitest plugin that extracts `<test>` blocks from `.utopia` files into `.utopia.test.ts`
- `@matthesketh/utopia-compiler` — `<test>` block parsing in SFCs (parsed but excluded from compiled output)
- `@matthesketh/utopia-cli` — `utopia test` command wrapping vitest with auto-injected plugin
- `@matthesketh/utopia-vite-plugin` — skip HMR refresh when only `<test>` block changes
- `llms.md` — comprehensive LLM reference with verified framework comparisons and every public API
- 613 tests passing across 19 test files

### Security

- Extracted all inline regexes across 10 packages to named exported constants with JSDoc comments
- `@matthesketh/utopia-ai` — MCP handler: configurable CORS origin via `MCPHandlerOptions`, sanitized error responses
- `@matthesketh/utopia-router` — hash fragment validation against `VALID_DOM_ID_RE` before `getElementById`
- `@matthesketh/utopia-runtime` — form validation: RFC 5321 max email length check (254 chars) to mitigate ReDoS
- Global regex `lastIndex` resets to prevent stale state on shared patterns

## [0.4.0] - 2026-02-11

### Added

- `@matthesketh/utopia-runtime` — `onMount()` and `onDestroy()` component lifecycle hooks
- `@matthesketh/utopia-runtime` — `createForm()` reactive form validation with built-in validators, field-level errors, and dirty/touched tracking
- `@matthesketh/utopia-compiler` — `u-else-if` directive for chained conditionals
- `@matthesketh/utopia-compiler` — `checkA11y()` compile-time accessibility checking (missing alt text, ARIA roles, form labels)
- `@matthesketh/utopia-core` — `sharedSignal()` for cross-tab state synchronization via BroadcastChannel
- `@matthesketh/utopia-router` — `useQuery()` and `useParams()` reactive route parameter utilities

## [0.3.1] - 2026-02-11

### Fixed

- `@matthesketh/utopia-router` — **Navigation flicker fix**: `createRouterView` now keeps old page content visible during async component loading, then swaps atomically. Previously, the container was cleared before the async load completed, causing a flash of empty content (just navbar/footer) between page transitions.

### Changed

- `@matthesketh/utopia-router` — `loadRouteComponent` refactored to return a `LoadResult` (node + cleanup) instead of directly mutating the container, enabling the atomic swap pattern
- `@matthesketh/utopia-router` — Stale navigation loads are now tracked via a monotonic `loadId` counter, preventing race conditions when rapidly navigating between pages
- `create-utopia` — Template dependency versions updated to `^0.3.0`

## [0.2.0] - 2026-02-10

### Added

- `@matthesketh/utopia-core` — `onEffectError()` global error handler for capturing effect errors programmatically
- `@matthesketh/utopia-compiler` — Event modifier compilation (`.prevent`, `.stop`, `.self`, `.once`, `.capture`, `.passive`)
- `@matthesketh/utopia-compiler` — `u-else` directive support (compiled as false branch of `createIf`)
- `@matthesketh/utopia-compiler` — `u-for` `:key` binding forwarded to `createFor()` key function parameter
- `@matthesketh/utopia-runtime` — SVG namespace support (`createElement` uses `createElementNS` for SVG tags)
- `@matthesketh/utopia-runtime` — `addEventListener` options parameter (for `.once`, `.capture`, `.passive`)
- `@matthesketh/utopia-router` — `meta` field on `Route` type for route metadata (auth, title, etc.)
- `@matthesketh/utopia-cli` — `--config` / `-c` flag for custom Vite config file path
- `@matthesketh/utopia-cli` — Port validation (range 0-65535, NaN detection)

### Fixed

- `@matthesketh/utopia-runtime` — Hydration mismatch handling: orphaned nodes properly removed after replacement
- `@matthesketh/utopia-runtime` — `clearNodes` now calls `__cleanup` on component nodes before DOM removal
- `@matthesketh/utopia-server` — Style deduplication: SSR style collection uses `Set<string>` to prevent duplicate CSS
- `@matthesketh/utopia-server` — Handler template injection uses `.replace()` instead of `.split().join()`
- `@matthesketh/utopia-router` — Trailing slash normalization in `matchRoute()` (`/about/` and `/about` match equivalently)
- `@matthesketh/utopia-ai` — Tool call ID generation uses monotonic counters (Google, Ollama adapters)
- `@matthesketh/utopia-ai` — Response validation in OpenAI adapter (empty choices) and Anthropic adapter (missing content)
- `@matthesketh/utopia-ai` — `parseSSEStream()` null body check (was using `!` assertion)
- `@matthesketh/utopia-ai` — Ollama streaming null body check with proper error message
- `@matthesketh/utopia-vite-plugin` — HMR compile error handling prevents dev server crashes on syntax errors

### Changed

- **Type safety overhaul** — replaced ~225 `any` types across 33 files with proper types/interfaces
- All `catch (err: any)` replaced with `catch (err: unknown)` and `instanceof Error` guards across AI, email, and MCP packages
- AI adapters now use `import type` for SDK types (OpenAI, Anthropic, Google) with SDK boundary casts
- Ollama adapter has fully typed request/response interfaces (no SDK dependency)
- MCP client uses generic `rpc<T>()` with typed response interfaces (`ToolsListResult`, `ResourcesListResult`, etc.)
- Email package has typed ambient module declarations for nodemailer, resend, and `@sendgrid/mail`
- Email components use `EmailComponentContext` with properly typed `$slots`
- Runtime/router use `DisposableNode` interface instead of `any` casts for `__cleanup`
- `Record<string, any>` replaced with `Record<string, unknown>` throughout (component props, route meta, SSR runtime)
- `@matthesketh/utopia-runtime` — `createElement()` return type from `HTMLElement` to `Element` (SVG compatibility)
- `@matthesketh/utopia-server` — `addEventListener` and `createFor` SSR stubs accept optional parameters to match client signatures
- `@matthesketh/utopia-ai` — Peer dependency ranges widened (openai `^4.0.0 || ^5.0.0 || ^6.0.0`, anthropic `^0.30.0 || ^0.74.0`, google `^0.21.0 || ^0.24.0`)
- ESLint config now enforces `@typescript-eslint/no-explicit-any` as warning (off for test files)
- Added Prettier configuration (singleQuote, trailingComma, 100 printWidth) with `format` and `format:check` scripts
- CI workflow now checks Prettier formatting
- `create-utopia` — Template dependency versions updated to `^0.2.0`

## [0.1.0] - 2025-06-01

### Added

- Stable API release with 447+ tests across 13 test files
- `@matthesketh/utopia-cli` — `utopia dev`, `utopia build`, `utopia preview` commands

## [0.0.1] - 2025-01-01

### Added

- `@matthesketh/utopia-core` — Fine-grained signals reactivity system (signal, computed, effect, batch, untrack)
- `@matthesketh/utopia-compiler` — Single-file component parser, template compiler, scoped CSS
- `@matthesketh/utopia-runtime` — DOM helpers, directives (u-if, u-for, u-model), component lifecycle, scheduler
- `@matthesketh/utopia-server` — Server-side rendering with renderToString, renderToStream, cursor-based hydration
- `@matthesketh/utopia-vite-plugin` — Vite transform for .utopia files with HMR and SSR alias resolution
- `@matthesketh/utopia-router` — File-based routing with History API, navigation guards, scroll management
- `@matthesketh/utopia-email` — Template-based email rendering with SMTP, Resend, and SendGrid adapters
- `@matthesketh/utopia-ai` — AI adapters for OpenAI, Anthropic, Google Gemini, and Ollama with streaming support
- `@matthesketh/utopia-ai` — MCP (Model Context Protocol) server and client with JSON-RPC 2.0
- `@matthesketh/utopia-ai` — Middleware hooks (onBeforeChat, onAfterChat, onError) and retry with exponential backoff
- `create-utopia` — CLI scaffolding tool with TypeScript/JavaScript, SSR, email, and AI options
