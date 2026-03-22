#!/usr/bin/env node
// ---------------------------------------------------------------------------
// @matthesketh/utopia-cli — CLI for the UtopiaJS framework
// ---------------------------------------------------------------------------
// Provides `utopia dev`, `utopia build`, `utopia preview`, `utopia test`,
// and `utopia mcp` commands.
// Wraps Vite and auto-injects the UtopiaJS plugin when no vite.config exists.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import {
  createServer,
  build as viteBuild,
  preview as vitePreview,
  type InlineConfig,
  type Plugin,
  type ServerOptions,
  type PreviewOptions,
} from 'vite';
import utopia from '@matthesketh/utopia-vite-plugin';
import { utopiaTestPlugin } from '@matthesketh/utopia-test/plugin';

// ---- Argument parsing -------------------------------------------------------

interface ParsedArgs {
  command: string | undefined;
  port: number | undefined;
  host: string | boolean | undefined;
  open: boolean;
  outDir: string | undefined;
  config: string | undefined;
  rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const META_FLAGS = new Set(['-v', '--version', '-h', '--help']);
  const command = args[0]
    ? META_FLAGS.has(args[0])
      ? args[0]
      : args[0].startsWith('-')
        ? undefined
        : args[0]
    : undefined;
  const flagArgs = command ? args.slice(1) : args;

  let port: number | undefined;
  let host: string | boolean | undefined;
  let open = false;
  let outDir: string | undefined;
  let config: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === '--port' && flagArgs[i + 1]) {
      const n = Number(flagArgs[++i]);
      if (Number.isNaN(n) || n < 0 || n > 65535) {
        console.error(`Invalid port: ${flagArgs[i]}`);
        process.exit(1);
      }
      port = n;
    } else if (arg === '--host') {
      const next = flagArgs[i + 1];
      if (next && !next.startsWith('-')) {
        host = next;
        i++;
      } else {
        host = true;
      }
    } else if (arg === '--open') {
      open = true;
    } else if (arg === '--outDir' && flagArgs[i + 1]) {
      outDir = flagArgs[++i];
    } else if ((arg === '--config' || arg === '-c') && flagArgs[i + 1]) {
      config = flagArgs[++i];
    } else {
      rest.push(arg);
    }
  }

  return { command, port, host, open, outDir, config, rest };
}

// ---- Config resolution ------------------------------------------------------

const CONFIG_FILES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts'];

function hasViteConfig(): boolean {
  return CONFIG_FILES.some((f) => existsSync(resolve(process.cwd(), f)));
}

function buildInlineConfig(args: ParsedArgs, mode: string): InlineConfig {
  const config: InlineConfig = { mode };

  // Use custom config file if specified, otherwise auto-detect.
  if (args.config) {
    config.configFile = resolve(process.cwd(), args.config);
  } else if (!hasViteConfig()) {
    // If no vite.config exists, auto-inject the UtopiaJS plugin.
    config.plugins = [utopia()];
  }

  // Server options (dev + preview).
  const server: ServerOptions = {};
  if (args.port !== undefined) server.port = args.port;
  if (args.host !== undefined) server.host = args.host;
  if (args.open) server.open = true;
  if (Object.keys(server).length > 0) config.server = server;

  // Build options.
  if (args.outDir) {
    config.build = { outDir: args.outDir };
  }

  return config;
}

// ---- Commands ---------------------------------------------------------------

async function dev(args: ParsedArgs): Promise<void> {
  const config = buildInlineConfig(args, 'development');
  const server = await createServer(config);
  await server.listen();
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
}

async function build(args: ParsedArgs): Promise<void> {
  const config = buildInlineConfig(args, 'production');
  await viteBuild(config);
}

async function preview(args: ParsedArgs): Promise<void> {
  const config = buildInlineConfig(args, 'production');

  // Preview has its own options namespace.
  const previewOpts: PreviewOptions = {};
  if (args.port !== undefined) previewOpts.port = args.port;
  if (args.host !== undefined) previewOpts.host = args.host;
  if (Object.keys(previewOpts).length > 0) config.preview = previewOpts;

  const server = await vitePreview(config);
  server.printUrls();
}

async function test(args: ParsedArgs): Promise<void> {
  const { startVitest } = await import('vitest/node');

  const config = buildInlineConfig(args, 'test');

  // Always inject the utopia test plugin alongside the main utopia plugin.
  const plugins = config.plugins ?? [];
  (plugins as Plugin[]).push(utopiaTestPlugin());
  config.plugins = plugins;

  const vitest = await startVitest('test', args.rest, {
    ...config,
  });

  await vitest?.close();
}

// ---- MCP commands -----------------------------------------------------------

const CONTENT_CONFIG_FILES = [
  'content.config.ts',
  'content.config.js',
  'content.config.mjs',
  'content.config.mts',
];

function findContentConfig(): string | undefined {
  return CONTENT_CONFIG_FILES.find((f) => existsSync(resolve(process.cwd(), f)));
}

async function mcpServe(): Promise<void> {
  const configFile = findContentConfig();
  if (!configFile) {
    process.stderr.write(
      'No content.config found. utopia mcp serve requires @matthesketh/utopia-content.\n',
    );
    process.exit(1);
  }

  // Use Vite in middleware mode to load the TypeScript content config.
  const server = await createServer({
    mode: 'production',
    logLevel: 'silent',
    server: { middlewareMode: true },
    plugins: [utopia()],
  });

  let handleRequest: (req: {
    jsonrpc: string;
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
  }) => Promise<{
    jsonrpc: string;
    id: string | number;
    result?: unknown;
    error?: { code: number; message: string };
  }>;

  try {
    // Loading the config triggers createContent() + defineCollection() side effects.
    await server.ssrLoadModule(resolve(process.cwd(), configFile));

    const content = (await server.ssrLoadModule('@matthesketh/utopia-content')) as {
      listCollections: () => string[];
      getCollectionAdapter: (name: string) => { config: unknown; adapter: unknown } | null;
    };

    const names = content.listCollections();
    if (names.length === 0) {
      process.stderr.write(
        'No collections defined. Add defineCollection() calls to your config.\n',
      );
      process.exit(1);
    }

    const contentMcp = (await server.ssrLoadModule('@matthesketh/utopia-content/mcp')) as {
      createContentTools: (getCollections: () => Map<string, unknown>) => Array<{
        definition: { name: string; description: string; inputSchema: unknown };
        handler: (params: Record<string, unknown>) => Promise<unknown>;
      }>;
    };

    const collectionMap = new Map<string, unknown>();
    for (const name of names) {
      const col = content.getCollectionAdapter(name);
      if (col) collectionMap.set(name, col);
    }

    const tools = contentMcp.createContentTools(() => collectionMap);
    const toolMap = new Map(tools.map((t) => [t.definition.name, t]));

    const serverInfo = { name: 'utopia-content', version: '1.0.0' };

    handleRequest = async (request) => {
      try {
        let result: unknown;
        switch (request.method) {
          case 'initialize':
            result = {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo,
            };
            break;
          case 'tools/list':
            result = {
              tools: tools.map((t) => ({
                name: t.definition.name,
                description: t.definition.description,
                inputSchema: t.definition.inputSchema,
              })),
            };
            break;
          case 'tools/call': {
            const params = request.params as { name: string; arguments?: Record<string, unknown> };
            const tool = toolMap.get(params.name);
            if (!tool) {
              return {
                jsonrpc: '2.0' as const,
                id: request.id,
                error: { code: -32602, message: `Unknown tool: ${params.name}` },
              };
            }
            result = await tool.handler(params.arguments ?? {});
            break;
          }
          case 'ping':
            result = {};
            break;
          default:
            return {
              jsonrpc: '2.0' as const,
              id: request.id,
              error: { code: -32601, message: `Method not found: ${request.method}` },
            };
        }
        return { jsonrpc: '2.0', id: request.id, result };
      } catch (err: unknown) {
        const e = err as { code?: number; message?: string };
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: e.code ?? -32603, message: e.message ?? 'Internal error' },
        };
      }
    };
  } catch (err) {
    await server.close();
    throw err;
  }

  // Close Vite — the content adapters use plain fs, not Vite internals.
  await server.close();

  // Stdio JSON-RPC loop (newline-delimited JSON).
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      // Notifications (no id) don't get a response.
      if (request.id == null) continue;
      const response = await handleRequest(request);
      process.stdout.write(JSON.stringify(response) + '\n');
    } catch {
      // Malformed JSON — ignore.
    }
  }
}

function findClaude(): string | null {
  const candidates = [
    'claude',
    resolve(process.env.HOME ?? '~', '.local/bin/claude'),
    resolve(process.env.HOME ?? '~', '.npm-global/bin/claude'),
    '/usr/local/bin/claude',
  ];
  for (const bin of candidates) {
    try {
      execSync(`${bin} --version`, { stdio: 'ignore' });
      return bin;
    } catch {
      // not found, try next
    }
  }
  return null;
}

function mcpInstall(): void {
  const claude = findClaude();
  if (!claude) {
    console.error(
      'Claude Code CLI not found. Install it first: npm i -g @anthropic-ai/claude-code',
    );
    process.exit(1);
  }

  try {
    execSync(`${claude} mcp add utopia-content -s project -- npx utopia mcp serve`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('\nUtopiaJS MCP server registered with Claude Code.');
    console.log('Claude Code can now manage your content collections.');
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('Failed to register MCP server:', e.message);
    process.exit(1);
  }
}

function printMcpHelp(): void {
  console.log(`
  utopia mcp — MCP server for Claude Code integration

  Usage:
    utopia mcp <subcommand>

  Subcommands:
    install  Register the UtopiaJS content MCP server with Claude Code
    serve    Start the MCP server over stdio (used by Claude Code)

  The MCP server exposes your content collections as tools:
    list_collections, list_entries, get_entry, create_entry,
    update_entry, delete_entry, search_entries, list_tags, publish_entry

  Quick start:
    utopia mcp install
`);
}

function printVersion(): void {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json');
  console.log(`utopia v${pkg.version}`);
}

function printHelp(): void {
  console.log(`
  utopia — UtopiaJS CLI

  Usage:
    utopia <command> [options]

  Commands:
    dev      Start development server
    build    Build for production
    preview  Preview production build
    test     Run component tests
    mcp      Claude Code MCP server integration
    create   Create a new project

  Options:
    --port <port>    Specify port
    --host [host]    Expose to network
    --open           Open browser on startup
    --outDir <dir>   Output directory (build only)
    -c, --config <file>  Use specified config file
    -h, --help       Show this help
    -v, --version    Show version
`);
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  switch (args.command) {
    case 'dev':
      await dev(args);
      break;
    case 'build':
      await build(args);
      break;
    case 'preview':
      await preview(args);
      break;
    case 'test':
      await test(args);
      break;
    case 'mcp': {
      const sub = args.rest[0];
      if (sub === 'serve') await mcpServe();
      else if (sub === 'install') mcpInstall();
      else printMcpHelp();
      break;
    }
    case 'create':
      console.log('To create a new UtopiaJS project, run:');
      console.log('  npx create-utopia [project-name]');
      break;
    case '-v':
    case '--version':
      printVersion();
      break;
    case '-h':
    case '--help':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
