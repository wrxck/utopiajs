// @vitest-environment node
// ============================================================================
// @matthesketh/utopia-cli — Test suite (real module, mocked Vite)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test.
// ---------------------------------------------------------------------------

const viteServer = {
  listen: vi.fn(),
  printUrls: vi.fn(),
  bindCLIShortcuts: vi.fn(),
  ssrLoadModule: vi.fn(),
  close: vi.fn(),
};

vi.mock('vite', () => ({
  createServer: vi.fn(async () => viteServer),
  build: vi.fn(async () => undefined),
  preview: vi.fn(async () => ({ printUrls: vi.fn() })),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

const execFileSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

const startVitestMock = vi.fn(async () => ({ close: vi.fn() }));
vi.mock('vitest/node', () => ({
  startVitest: (...args: unknown[]) => startVitestMock(...args),
}));

import { existsSync } from 'node:fs';
import { createServer, build as viteBuild, preview as vitePreview } from 'vite';
import {
  parseArgs,
  buildInlineConfig,
  hasViteConfig,
  findContentConfig,
  dev,
  build,
  preview,
  test as testCommand,
  createMcpRequestHandler,
  runStdioLoop,
  loadContentTools,
  mcpServe,
  findClaude,
  mcpInstall,
  printVersion,
  main,
  isDirectInvocation,
  type ParsedArgs,
  type McpTool,
} from './index';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(existsSync).mockReturnValue(false);
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function argsFor(...rest: string[]): ParsedArgs {
  return parseArgs(['node', 'utopia', ...rest]);
}

// =========================================================================
// Argument parsing
// =========================================================================

describe('parseArgs', () => {
  it('parses a bare command', () => {
    const args = argsFor('dev');
    expect(args.command).toBe('dev');
    expect(args.port).toBeUndefined();
    expect(args.host).toBeUndefined();
    expect(args.open).toBe(false);
    expect(args.rest).toEqual([]);
  });

  it('parses --port', () => {
    expect(argsFor('dev', '--port', '3001').port).toBe(3001);
  });

  it('rejects a non-numeric port', () => {
    expect(() => argsFor('dev', '--port', 'abc')).toThrow('process.exit(1)');
    expect(errorSpy).toHaveBeenCalledWith('Invalid port: abc');
  });

  it('rejects out-of-range ports', () => {
    expect(() => argsFor('dev', '--port', '70000')).toThrow('process.exit(1)');
    expect(() => argsFor('dev', '--port', '-1')).toThrow('process.exit(1)');
  });

  it('treats a trailing --port with no value as a rest argument', () => {
    const args = argsFor('dev', '--port');
    expect(args.port).toBeUndefined();
    expect(args.rest).toEqual(['--port']);
  });

  it('parses --host as a boolean when no value follows', () => {
    expect(argsFor('dev', '--host').host).toBe(true);
    expect(argsFor('dev', '--host', '--open').host).toBe(true);
  });

  it('parses --host with a value', () => {
    expect(argsFor('dev', '--host', '0.0.0.0').host).toBe('0.0.0.0');
  });

  it('parses --open, --outDir and --config/-c', () => {
    const args = argsFor('build', '--open', '--outDir', 'out', '--config', 'my.config.ts');
    expect(args.open).toBe(true);
    expect(args.outDir).toBe('out');
    expect(args.config).toBe('my.config.ts');
    expect(argsFor('build', '-c', 'alt.config.ts').config).toBe('alt.config.ts');
  });

  it('collects unknown arguments into rest', () => {
    expect(argsFor('test', 'src/foo.test.ts', '--watch').rest).toEqual([
      'src/foo.test.ts',
      '--watch',
    ]);
  });

  it('recognizes meta flags as commands', () => {
    expect(argsFor('--help').command).toBe('--help');
    expect(argsFor('-h').command).toBe('-h');
    expect(argsFor('--version').command).toBe('--version');
    expect(argsFor('-v').command).toBe('-v');
  });

  it('treats a leading non-meta flag as flags without a command', () => {
    const args = argsFor('--port', '4000');
    expect(args.command).toBeUndefined();
    expect(args.port).toBe(4000);
  });

  it('returns undefined command for no arguments', () => {
    expect(argsFor().command).toBeUndefined();
  });
});

// =========================================================================
// Config resolution
// =========================================================================

describe('buildInlineConfig', () => {
  it('injects the utopia plugin when no vite.config exists', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const config = buildInlineConfig(argsFor('dev'), 'development');
    expect(config.mode).toBe('development');
    expect(config.plugins).toHaveLength(1);
    expect((config.plugins![0] as { name: string }).name).toBe('utopia');
  });

  it('does not inject the plugin when a vite.config exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const config = buildInlineConfig(argsFor('dev'), 'development');
    expect(config.plugins).toBeUndefined();
    expect(config.configFile).toBeUndefined();
  });

  it('uses an explicit --config file without auto-injection', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const config = buildInlineConfig(argsFor('dev', '--config', 'custom.config.ts'), 'development');
    expect(config.configFile).toMatch(/custom\.config\.ts$/);
    expect(config.plugins).toBeUndefined();
  });

  it('maps port/host/open to server options', () => {
    const config = buildInlineConfig(
      argsFor('dev', '--port', '4000', '--host', '--open'),
      'development',
    );
    expect(config.server).toEqual({ port: 4000, host: true, open: true });
  });

  it('omits server options when no flags are given', () => {
    const config = buildInlineConfig(argsFor('build'), 'production');
    expect(config.server).toBeUndefined();
  });

  it('maps --outDir to build options', () => {
    const config = buildInlineConfig(argsFor('build', '--outDir', 'output'), 'production');
    expect(config.build).toEqual({ outDir: 'output' });
  });
});

describe('config detection', () => {
  it('hasViteConfig checks the known config filenames', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(hasViteConfig()).toBe(false);
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('vite.config.mts'));
    expect(hasViteConfig()).toBe(true);
  });

  it('findContentConfig returns the first existing content config', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(findContentConfig()).toBeUndefined();
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('content.config.js'));
    expect(findContentConfig()).toBe('content.config.js');
  });
});

// =========================================================================
// Commands
// =========================================================================

describe('commands', () => {
  it('dev starts a Vite dev server and binds shortcuts', async () => {
    await dev(argsFor('dev', '--port', '3001'));
    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'development', server: { port: 3001 } }),
    );
    expect(viteServer.listen).toHaveBeenCalled();
    expect(viteServer.printUrls).toHaveBeenCalled();
    expect(viteServer.bindCLIShortcuts).toHaveBeenCalledWith({ print: true });
  });

  it('build runs a production Vite build', async () => {
    await build(argsFor('build', '--outDir', 'out'));
    expect(viteBuild).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'production', build: { outDir: 'out' } }),
    );
  });

  it('preview maps port and host into preview options', async () => {
    await preview(argsFor('preview', '--port', '5000', '--host', '0.0.0.0'));
    expect(vitePreview).toHaveBeenCalledWith(
      expect.objectContaining({ preview: { port: 5000, host: '0.0.0.0' } }),
    );
  });

  it('preview omits preview options when no flags are given', async () => {
    await preview(argsFor('preview'));
    const config = vi.mocked(vitePreview).mock.calls[0][0]!;
    expect(config.preview).toBeUndefined();
  });

  it('test reuses config-file plugins when a vite.config exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    await testCommand(argsFor('test'));
    const config = startVitestMock.mock.calls[0][2] as unknown as {
      plugins: Array<{ name: string }>;
    };
    // Only the test plugin is injected inline; the utopia plugin comes from
    // the user's vite.config.
    expect(config.plugins.map((p) => p.name)).toEqual(['utopia-test']);
  });

  it('test tolerates startVitest returning nothing', async () => {
    startVitestMock.mockResolvedValueOnce(undefined as never);
    await expect(testCommand(argsFor('test'))).resolves.toBeUndefined();
  });

  it('test starts vitest with the utopia test plugin injected', async () => {
    await testCommand(argsFor('test', 'some.test.ts'));
    expect(startVitestMock).toHaveBeenCalledTimes(1);
    const [kind, filters, config] = startVitestMock.mock.calls[0] as unknown as [
      string,
      string[],
      { plugins: Array<{ name: string }> },
    ];
    expect(kind).toBe('test');
    expect(filters).toEqual(['some.test.ts']);
    const names = config.plugins.map((p) => p.name);
    expect(names).toContain('utopia');
    expect(names).toContain('utopia-test');
  });
});

// =========================================================================
// MCP request handling
// =========================================================================

function makeTools(): McpTool[] {
  return [
    {
      definition: { name: 'echo', description: 'Echo params', inputSchema: { type: 'object' } },
      handler: vi.fn(async (params: Record<string, unknown>) => ({ echoed: params })),
    },
    {
      definition: { name: 'boom', description: 'Always throws', inputSchema: {} },
      handler: vi.fn(async () => {
        throw Object.assign(new Error('kaboom'), { code: -32000 });
      }),
    },
  ];
}

describe('createMcpRequestHandler', () => {
  it('responds to initialize with protocol info', async () => {
    const handle = createMcpRequestHandler(makeTools());
    const res = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'utopia-content', version: '1.0.0' },
      },
    });
  });

  it('lists tools', async () => {
    const handle = createMcpRequestHandler(makeTools());
    const res = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (res.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual(['echo', 'boom']);
  });

  it('calls a tool with arguments', async () => {
    const handle = createMcpRequestHandler(makeTools());
    const res = await handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { a: 1 } },
    });
    expect(res.result).toEqual({ echoed: { a: 1 } });
  });

  it('defaults tool arguments to an empty object', async () => {
    const tools = makeTools();
    const handle = createMcpRequestHandler(tools);
    await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo' } });
    expect(tools[0].handler).toHaveBeenCalledWith({});
  });

  it('returns -32602 for an unknown tool', async () => {
    const handle = createMcpRequestHandler(makeTools());
    const res = await handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'nope' },
    });
    expect(res.error).toEqual({ code: -32602, message: 'Unknown tool: nope' });
  });

  it('returns -32601 for an unknown method', async () => {
    const handle = createMcpRequestHandler(makeTools());
    const res = await handle({ jsonrpc: '2.0', id: 6, method: 'wat' });
    expect(res.error).toEqual({ code: -32601, message: 'Method not found: wat' });
  });

  it('responds to ping with an empty result', async () => {
    const handle = createMcpRequestHandler(makeTools());
    const res = await handle({ jsonrpc: '2.0', id: 7, method: 'ping' });
    expect(res.result).toEqual({});
  });

  it('maps tool errors onto JSON-RPC errors, preserving codes', async () => {
    const handle = createMcpRequestHandler(makeTools());
    const res = await handle({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'boom' },
    });
    expect(res.error).toEqual({ code: -32000, message: 'kaboom' });
  });

  it('falls back to -32603 for errors without a code', async () => {
    const tools: McpTool[] = [
      {
        definition: { name: 'bad', description: '', inputSchema: {} },
        handler: async () => {
          throw {};
        },
      },
    ];
    const handle = createMcpRequestHandler(tools);
    const res = await handle({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'bad' },
    });
    expect(res.error).toEqual({ code: -32603, message: 'Internal error' });
  });
});

describe('runStdioLoop', () => {
  it('answers requests, skips notifications, blank and malformed lines', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (c) => chunks.push(String(c)));

    const handle = createMcpRequestHandler(makeTools());
    const loop = runStdioLoop(handle, input, output);

    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
    input.write('\n'); // blank
    input.write('{not json}\n'); // malformed
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notify' }) + '\n'); // notification
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'nope' }) + '\n');
    input.end();
    await loop;

    const responses = chunks
      .join('')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ id: 1, result: {} });
    expect(responses[1]).toMatchObject({ id: 2, error: { code: -32601 } });
  });
});

// =========================================================================
// MCP serve / content loading
// =========================================================================

function mockContentModules(collections: string[], missingAdapters: string[] = []): void {
  const adapters = new Map(
    collections
      .filter((n) => !missingAdapters.includes(n))
      .map((n) => [n, { config: {}, adapter: {} }]),
  );
  viteServer.ssrLoadModule.mockImplementation(async (specifier: string) => {
    if (specifier === '@matthesketh/utopia-content') {
      return {
        listCollections: () => collections,
        getCollectionAdapter: (name: string) => adapters.get(name) ?? null,
      };
    }
    if (specifier === '@matthesketh/utopia-content/mcp') {
      return {
        createContentTools: (getCollections: () => Map<string, unknown>) => [
          {
            definition: { name: 'list_collections', description: '', inputSchema: {} },
            handler: async () => [...getCollections().keys()],
          },
        ],
      };
    }
    return {}; // the user's content.config module
  });
}

describe('loadContentTools', () => {
  it('loads collections through Vite SSR and closes the server', async () => {
    mockContentModules(['blog', 'docs']);
    const tools = await loadContentTools('content.config.ts');
    expect(tools).toHaveLength(1);
    await expect(tools[0].handler({})).resolves.toEqual(['blog', 'docs']);
    expect(viteServer.close).toHaveBeenCalled();
  });

  it('skips collections whose adapter cannot be resolved', async () => {
    mockContentModules(['blog', 'ghost'], ['ghost']);
    const tools = await loadContentTools('content.config.ts');
    await expect(tools[0].handler({})).resolves.toEqual(['blog']);
  });

  it('exits when no collections are defined, still closing the server', async () => {
    mockContentModules([]);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(loadContentTools('content.config.ts')).rejects.toThrow('process.exit(1)');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('No collections defined'));
    expect(viteServer.close).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('closes the server when config loading fails', async () => {
    viteServer.ssrLoadModule.mockRejectedValue(new Error('bad config'));
    await expect(loadContentTools('content.config.ts')).rejects.toThrow('bad config');
    expect(viteServer.close).toHaveBeenCalled();
  });
});

describe('mcpServe', () => {
  it('exits when no content config exists', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(mcpServe()).rejects.toThrow('process.exit(1)');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('No content.config found'));
    stderrSpy.mockRestore();
  });

  it('serves loaded tools over a stdio JSON-RPC loop', async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('content.config.ts'));
    mockContentModules(['blog']);

    // Substitute stdio with in-memory streams for the duration of the call.
    const input = new PassThrough();
    const chunks: string[] = [];
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', { configurable: true, value: input });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => {
      chunks.push(String(c));
      return true;
    }) as never);

    try {
      const serving = mcpServe();
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
      input.end();
      await serving;
    } finally {
      Object.defineProperty(process, 'stdin', stdinDescriptor);
      stdoutSpy.mockRestore();
    }

    const response = JSON.parse(chunks.join('').trim());
    expect(response.id).toBe(1);
    expect(response.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'list_collections',
    ]);
  });
});

// =========================================================================
// Claude Code integration
// =========================================================================

describe('findClaude', () => {
  it('returns the first candidate whose --version succeeds', () => {
    execFileSyncMock.mockReturnValue(Buffer.from(''));
    expect(findClaude()).toBe('claude');
  });

  it('returns null when no candidate works', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(findClaude()).toBeNull();
  });

  it('falls through failing candidates', () => {
    execFileSyncMock
      .mockImplementationOnce(() => {
        throw new Error('no');
      })
      .mockReturnValue(Buffer.from(''));
    const found = findClaude();
    expect(found).not.toBeNull();
    expect(found).not.toBe('claude');
  });

  it('copes with a missing HOME environment variable', () => {
    const home = process.env.HOME;
    delete process.env.HOME;
    try {
      execFileSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      expect(findClaude()).toBeNull();
    } finally {
      if (home !== undefined) process.env.HOME = home;
    }
  });
});

describe('mcpInstall', () => {
  it('exits with guidance when the Claude CLI is missing', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(() => mcpInstall()).toThrow('process.exit(1)');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Claude Code CLI not found'));
  });

  it('registers the MCP server via the Claude CLI', () => {
    execFileSyncMock.mockReturnValue(Buffer.from(''));
    mcpInstall();
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'claude',
      ['mcp', 'add', 'utopia-content', '-s', 'project', '--', 'npx', 'utopia', 'mcp', 'serve'],
      expect.objectContaining({ stdio: 'inherit' }),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('registered with Claude Code'));
  });

  it('exits when registration fails', () => {
    // findClaude succeeds, the registration call fails.
    execFileSyncMock.mockReturnValueOnce(Buffer.from('')).mockImplementationOnce(() => {
      throw new Error('registration failed');
    });
    expect(() => mcpInstall()).toThrow('process.exit(1)');
    expect(errorSpy).toHaveBeenCalledWith('Failed to register MCP server:', 'registration failed');
  });
});

// =========================================================================
// Version / entry
// =========================================================================

describe('printVersion', () => {
  it('prints the package version', () => {
    printVersion();
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^utopia v\d+\.\d+\.\d+$/));
  });
});

describe('main dispatch', () => {
  const run = (...rest: string[]) => main(['node', 'utopia', ...rest]);

  it('dispatches dev', async () => {
    await run('dev');
    expect(createServer).toHaveBeenCalled();
  });

  it('dispatches build', async () => {
    await run('build');
    expect(viteBuild).toHaveBeenCalled();
  });

  it('dispatches preview', async () => {
    await run('preview');
    expect(vitePreview).toHaveBeenCalled();
  });

  it('dispatches test', async () => {
    await run('test');
    expect(startVitestMock).toHaveBeenCalled();
  });

  it('dispatches mcp serve', async () => {
    // No content config: serve exits early, proving the dispatch reached it.
    vi.mocked(existsSync).mockReturnValue(false);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(run('mcp', 'serve')).rejects.toThrow('process.exit(1)');
    stderrSpy.mockRestore();
  });

  it('prints mcp help for unknown mcp subcommands', async () => {
    await run('mcp');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('utopia mcp'));
  });

  it('dispatches mcp install', async () => {
    execFileSyncMock.mockReturnValue(Buffer.from(''));
    await run('mcp', 'install');
    expect(execFileSyncMock).toHaveBeenCalled();
  });

  it('points create at create-utopia', async () => {
    await run('create');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('npx create-utopia'));
  });

  it('prints the version for -v/--version', async () => {
    await run('-v');
    await run('--version');
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^utopia v/));
  });

  it('prints help for -h/--help/no command', async () => {
    await run('-h');
    await run('--help');
    await run();
    const helpCalls = logSpy.mock.calls.filter((c) => String(c[0]).includes('utopia — UtopiaJS'));
    expect(helpCalls).toHaveLength(3);
  });

  it('errors and exits for unknown commands', async () => {
    await expect(run('frobnicate')).rejects.toThrow('process.exit(1)');
    expect(errorSpy).toHaveBeenCalledWith('Unknown command: frobnicate');
  });
});

describe('isDirectInvocation', () => {
  it('is false for missing or unrelated argv[1]', () => {
    expect(isDirectInvocation(undefined)).toBe(false);
    expect(isDirectInvocation('/no/such/file.js')).toBe(false);
    expect(isDirectInvocation(process.argv[1])).toBe(false);
  });

  it('is true when argv[1] is this module', () => {
    const self = new URL(import.meta.url).pathname;
    expect(isDirectInvocation(self, import.meta.url)).toBe(true);
  });
});
