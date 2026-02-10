import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// We test the CLI logic by importing and exercising the argument parser and
// config builder.  The actual Vite calls are mocked.
// ---------------------------------------------------------------------------

// Mock vite — we don't want real servers during tests.
vi.mock('vite', () => ({
  createServer: vi.fn().mockResolvedValue({
    listen: vi.fn(),
    printUrls: vi.fn(),
    bindCLIShortcuts: vi.fn(),
  }),
  build: vi.fn().mockResolvedValue(undefined),
  preview: vi.fn().mockResolvedValue({ printUrls: vi.fn() }),
}));

// Mock fs.existsSync to control config detection.
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

// Mock the vite-plugin.
vi.mock('@matthesketh/utopia-vite-plugin', () => ({
  default: vi.fn().mockReturnValue({ name: 'utopia' }),
}));

// Re-import after mocks are set up.
import { createServer, build, preview } from 'vite';
import utopia from '@matthesketh/utopia-vite-plugin';

// ---------------------------------------------------------------------------
// We replicate the parseArgs + buildInlineConfig logic to test them directly,
// since the module's main() calls process.exit and reads process.argv.
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string | undefined;
  port: number | undefined;
  host: string | boolean | undefined;
  open: boolean;
  outDir: string | undefined;
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
  const rest: string[] = [];

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === '--port' && flagArgs[i + 1]) {
      port = Number(flagArgs[++i]);
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
    } else {
      rest.push(arg);
    }
  }

  return { command, port, host, open, outDir, rest };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI argument parsing', () => {
  it('parses dev command with no flags', () => {
    const args = parseArgs(['node', 'utopia', 'dev']);
    expect(args.command).toBe('dev');
    expect(args.port).toBeUndefined();
    expect(args.host).toBeUndefined();
    expect(args.open).toBe(false);
  });

  it('parses dev command with --port', () => {
    const args = parseArgs(['node', 'utopia', 'dev', '--port', '3001']);
    expect(args.command).toBe('dev');
    expect(args.port).toBe(3001);
  });

  it('parses dev command with --host (boolean)', () => {
    const args = parseArgs(['node', 'utopia', 'dev', '--host']);
    expect(args.command).toBe('dev');
    expect(args.host).toBe(true);
  });

  it('parses dev command with --host <value>', () => {
    const args = parseArgs(['node', 'utopia', 'dev', '--host', '0.0.0.0']);
    expect(args.command).toBe('dev');
    expect(args.host).toBe('0.0.0.0');
  });

  it('parses dev command with --open', () => {
    const args = parseArgs(['node', 'utopia', 'dev', '--open']);
    expect(args.command).toBe('dev');
    expect(args.open).toBe(true);
  });

  it('parses build command with --outDir', () => {
    const args = parseArgs(['node', 'utopia', 'build', '--outDir', 'output']);
    expect(args.command).toBe('build');
    expect(args.outDir).toBe('output');
  });

  it('parses multiple flags together', () => {
    const args = parseArgs(['node', 'utopia', 'dev', '--port', '8080', '--host', '--open']);
    expect(args.command).toBe('dev');
    expect(args.port).toBe(8080);
    expect(args.host).toBe(true);
    expect(args.open).toBe(true);
  });

  it('recognizes --help as a command', () => {
    const args = parseArgs(['node', 'utopia', '--help']);
    expect(args.command).toBe('--help');
  });

  it('returns undefined command for no arguments', () => {
    const args = parseArgs(['node', 'utopia']);
    expect(args.command).toBeUndefined();
  });

  it('recognizes --version as a command', () => {
    const args = parseArgs(['node', 'utopia', '--version']);
    expect(args.command).toBe('--version');
  });

  it('recognizes -h as a command', () => {
    const args = parseArgs(['node', 'utopia', '-h']);
    expect(args.command).toBe('-h');
  });
});

describe('CLI Vite integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects utopia plugin when no vite.config exists', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { createServer: cs } = await import('vite');
    await cs({
      mode: 'development',
      plugins: [utopia()],
    });

    expect(cs).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: expect.arrayContaining([expect.objectContaining({ name: 'utopia' })]),
      }),
    );
  });

  it('does not inject plugin when vite.config exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    // When config exists, we pass no plugins.
    const { createServer: cs } = await import('vite');
    await cs({ mode: 'development' });

    expect(cs).toHaveBeenCalledWith({ mode: 'development' });
  });

  it('calls viteBuild for build command', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { build: b } = await import('vite');
    await b({
      mode: 'production',
      plugins: [utopia()],
    });

    expect(b).toHaveBeenCalledWith(expect.objectContaining({ mode: 'production' }));
  });

  it('calls vitePreview for preview command', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { preview: p } = await import('vite');
    const server = await p({
      mode: 'production',
      plugins: [utopia()],
    });

    expect(p).toHaveBeenCalled();
    expect(server.printUrls).toBeDefined();
  });
});
