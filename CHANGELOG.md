# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
