# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
