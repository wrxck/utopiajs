# @matthesketh/utopia-cli

CLI for the UtopiaJS framework. Wraps Vite and auto-injects the UtopiaJS plugin when no `vite.config` exists.

## Install

```bash
pnpm add -D @matthesketh/utopia-cli
```

Or scaffold a new project (includes the CLI automatically):

```bash
npx create-utopia my-app
```

## Commands

```bash
utopia dev        # Start development server
utopia build      # Build for production
utopia preview    # Preview production build
utopia test       # Run component tests (vitest + <test> block extraction)
utopia create     # Prints instructions for npx create-utopia
```

## Options

| Flag | Description |
|------|-------------|
| `--port <port>` | Specify port (dev/preview) |
| `--host [host]` | Expose to network |
| `--open` | Open browser on startup |
| `--outDir <dir>` | Output directory (build) |
| `-c, --config <file>` | Use a specific Vite config file |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## How It Works

- If no `vite.config.{ts,js,mjs,mts}` exists, the CLI auto-injects `@matthesketh/utopia-vite-plugin`
- `utopia test` auto-injects the `utopiaTestPlugin` from `@matthesketh/utopia-test/plugin`, which extracts `<test>` blocks from `.utopia` files into vitest-discoverable companion files
- All commands pass through to Vite under the hood

## License

MIT
