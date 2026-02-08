# Contributing to UtopiaJS

Contributions are welcome. Whether it's a bug fix, new feature, documentation improvement, or test — every contribution helps.

## Development Setup

```bash
git clone https://github.com/wrxck/utopiajs.git
cd utopiajs
pnpm install
pnpm build
pnpm test
```

Requirements: Node.js >= 20, pnpm >= 9.

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `@utopia/core` | Signals reactivity system |
| `@utopia/compiler` | SFC parser + template compiler + scoped CSS |
| `@utopia/runtime` | DOM helpers, directives, component lifecycle, scheduler, hydration |
| `@utopia/server` | SSR: renderToString, renderToStream, server router, handler |
| `@utopia/vite-plugin` | Vite transform for .utopia files, HMR, SSR alias resolution |
| `@utopia/router` | File-based routing with History API, navigation guards |
| `@utopia/email` | Template-based email rendering with adapter pattern |
| `@utopia/ai` | AI adapters (OpenAI, Anthropic, Google, Ollama) + MCP |
| `create-utopia` | CLI scaffolding tool |

## Making Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Ensure tests pass: `pnpm test`
5. Submit a pull request

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation changes
- `test:` — adding or updating tests
- `refactor:` — code changes that neither fix bugs nor add features
- `chore:` — maintenance tasks

## Code Style

- TypeScript by default
- Keep it simple — no unnecessary abstractions
- Follow existing patterns in the codebase
- Add tests for new functionality

## Testing

Tests use [Vitest](https://vitest.dev/) with jsdom environment:

```bash
pnpm test        # watch mode
pnpm test:run    # single run
```

## Reporting Bugs

Open a [GitHub Issue](https://github.com/wrxck/utopiajs/issues) with:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0-or-later](LICENSE) license.
