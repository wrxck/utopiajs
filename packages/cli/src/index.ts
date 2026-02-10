#!/usr/bin/env node
// ---------------------------------------------------------------------------
// @matthesketh/utopia-cli — CLI for the UtopiaJS framework
// ---------------------------------------------------------------------------
// Provides `utopia dev`, `utopia build`, and `utopia preview` commands.
// Wraps Vite and auto-injects the UtopiaJS plugin when no vite.config exists.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import {
  createServer,
  build as viteBuild,
  preview as vitePreview,
  type InlineConfig,
  type ServerOptions,
  type PreviewOptions,
} from 'vite';
import utopia from '@matthesketh/utopia-vite-plugin';

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
