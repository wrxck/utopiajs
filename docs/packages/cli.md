# @matthesketh/utopia-cli

CLI for the UtopiaJS framework. Wraps Vite and auto-injects the UtopiaJS plugin when no `vite.config` is present.

## install

Included when you scaffold with `npx create-utopia`. To install standalone:

```bash
npm install -D @matthesketh/utopia-cli
```

## commands

### utopia dev

Start the Vite development server.

```bash
utopia dev
utopia dev --port 4000
utopia dev --host
utopia dev --host 0.0.0.0 --open
```

### utopia build

Production build.

```bash
utopia build
utopia build --outDir dist/public
```

For SSR projects the package.json scripts use:

```bash
npm run build:client   # vite build --outDir dist/client
npm run build:server   # vite build --outDir dist/server --ssr src/entry-server.ts
```

### utopia preview

Preview the production build locally.

```bash
utopia preview
utopia preview --port 8080
```

### utopia test

Run component tests via Vitest. Auto-injects the utopia test plugin.

```bash
utopia test
utopia test --reporter verbose
```

### utopia mcp

Claude Code MCP server integration for content collections.

```bash
utopia mcp install   # register the MCP server with Claude Code
utopia mcp serve     # start the stdio MCP server (used internally by Claude Code)
```

`utopia mcp install` requires a `content.config.ts` (or `.js`) in the project root and the Claude Code CLI installed globally.

The MCP server exposes tools: `list_collections`, `list_entries`, `get_entry`, `create_entry`, `update_entry`, `delete_entry`, `search_entries`, `list_tags`, `publish_entry`.

### utopia create

Alias that prints instructions to use `npx create-utopia`.

## global options

| flag | description |
|---|---|
| `--port <port>` | port number |
| `--host [host]` | expose to network |
| `--open` | open browser on startup |
| `--outDir <dir>` | output directory (build only) |
| `-c, --config <file>` | use specified vite config file |
| `-v, --version` | print version |
| `-h, --help` | show help |
