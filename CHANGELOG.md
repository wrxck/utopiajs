# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
