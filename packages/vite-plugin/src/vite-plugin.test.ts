// @vitest-environment node
// ============================================================================
// @matthesketh/utopia-vite-plugin — Test suite
// ============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compile } from '@matthesketh/utopia-compiler';
import type { HmrContext, ModuleNode, Plugin } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import utopiaPlugin, { defineConfig } from '@/index';

/** Loosely-typed view of a plugin hook so tests can invoke it directly. */
type AnyHook = (this: unknown, ...args: any[]) => any;

/**
 * Call signatures for the two hooks the tests invoke through `.call()`. Vite
 * declares them as object-hook unions, so they need narrowing before use — but
 * narrowing to `Function` throws away the argument and return types with it.
 */
type TransformHook = (this: unknown, code: string, id: string) => { code: string } | null;
type LoadHook = (this: unknown, id: string) => string | null;

// Helper to extract the plugin hooks from the returned plugin object.
function getPlugin(options?: Parameters<typeof utopiaPlugin>[0]): Plugin {
  const plugin = utopiaPlugin(options);
  // configResolved must be called to set up the filter.
  if (typeof plugin.configResolved === 'function') {
    (plugin.configResolved as unknown as AnyHook)({ plugins: [] });
  }
  return plugin;
}

const SFC = `<template>
  <p>Count: {{ count() }}</p>
</template>

<script>
  import { signal } from '@matthesketh/utopia-core';
  const count = signal(0);
</script>

<style>
  p { color: red; }
</style>
`;

const SFC_NO_STYLE = `<template>
  <p>plain</p>
</template>
`;

function transform(plugin: Plugin, code: string, id: string): { code: string } | undefined {
  return (plugin.transform as unknown as AnyHook).call({}, code, id);
}

function load(plugin: Plugin, id: string): string | undefined {
  return (plugin.load as unknown as AnyHook).call({}, id);
}

// =========================================================================
// Virtual routes module
// =========================================================================

describe('virtual:utopia-routes', () => {
  it('resolves virtual:utopia-routes to the prefixed ID', () => {
    const plugin = getPlugin();
    const resolveId = plugin.resolveId as unknown as AnyHook;
    const result = resolveId.call({ resolve: () => null }, 'virtual:utopia-routes');
    expect(result).toBe('\0virtual:utopia-routes');
  });

  it('loads virtual routes module with correct glob pattern', () => {
    const plugin = getPlugin();
    const code = load(plugin, '\0virtual:utopia-routes')!;
    expect(code).toContain('import { buildRouteTable }');
    expect(code).toContain('import.meta.glob');
    expect(code).toContain('+{page,layout,error,server}');
    expect(code).toContain('src/routes');
    expect(code).toContain('export default routes');
    expect(code).toContain('apiManifest');
  });

  it('respects custom routesDir option', () => {
    const plugin = getPlugin({ routesDir: 'app/pages' });
    const code = load(plugin, '\0virtual:utopia-routes')!;
    expect(code).toContain('app/pages');
    expect(code).not.toContain('src/routes');
  });

  it('does not resolve unrelated virtual modules', () => {
    const plugin = getPlugin();
    const resolveId = plugin.resolveId as unknown as AnyHook;
    const result = resolveId.call({ resolve: () => null }, 'virtual:other');
    expect(result).toBeUndefined();
  });

  it('does not load unrelated virtual modules', () => {
    const plugin = getPlugin();
    expect(load(plugin, '\0virtual:other')).toBeUndefined();
  });

  it('does not load non-virtual ids', () => {
    const plugin = getPlugin();
    expect(load(plugin, '/src/App.utopia')).toBeUndefined();
  });
});

// =========================================================================
// Plugin configuration
// =========================================================================

describe('plugin configuration', () => {
  it('has the correct plugin name', () => {
    const plugin = getPlugin();
    expect(plugin.name).toBe('utopia');
  });

  it('enforces pre ordering', () => {
    const plugin = getPlugin();
    expect(plugin.enforce).toBe('pre');
  });

  it('aliases the runtime to the SSR runtime for SSR builds', () => {
    const plugin = getPlugin();
    const config = plugin.config as unknown as AnyHook;
    const result = config({}, { isSsrBuild: true });
    expect(result.resolve.alias['@matthesketh/utopia-runtime']).toBe(
      '@matthesketh/utopia-server/ssr-runtime',
    );
    expect(config({}, { isSsrBuild: false })).toBeUndefined();
  });
});

// =========================================================================
// SSR module resolution
// =========================================================================

describe('SSR runtime redirection', () => {
  it('redirects @matthesketh/utopia-runtime to the SSR runtime for dev SSR', () => {
    const plugin = getPlugin();
    const resolveId = plugin.resolveId as unknown as AnyHook;
    const resolve = vi.fn().mockReturnValue('resolved-ssr-runtime');
    const result = resolveId.call({ resolve }, '@matthesketh/utopia-runtime', '/src/main.ts', {
      ssr: true,
    });
    expect(resolve).toHaveBeenCalledWith('@matthesketh/utopia-server/ssr-runtime', '/src/main.ts', {
      skipSelf: true,
      ssr: true,
    });
    expect(result).toBe('resolved-ssr-runtime');
  });

  it('does not redirect the runtime for non-SSR resolution', () => {
    const plugin = getPlugin();
    const resolveId = plugin.resolveId as unknown as AnyHook;
    const resolve = vi.fn();
    const result = resolveId.call({ resolve }, '@matthesketh/utopia-runtime', '/src/main.ts', {
      ssr: false,
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

// =========================================================================
// Transform + virtual CSS modules
// =========================================================================

describe('transform', () => {
  it('compiles a .utopia file and appends a CSS import for its styles', () => {
    const plugin = getPlugin();
    const result = transform(plugin, SFC, '/src/App.utopia')!;
    expect(result.code).toContain('export default');
    expect(result.code).toContain(`import "/src/App.utopia.css";`);
  });

  it('serves the extracted CSS through the virtual module pipeline', () => {
    const plugin = getPlugin();
    transform(plugin, SFC, '/src/App.utopia');

    const resolveId = plugin.resolveId as unknown as AnyHook;
    const resolved = resolveId.call({ resolve: () => null }, '/src/App.utopia.css');
    expect(resolved).toBe('\0/src/App.utopia.css');

    const css = load(plugin, '\0/src/App.utopia.css');
    expect(css).toContain('color: red');
  });

  it('does not append a CSS import when the component has no styles', () => {
    const plugin = getPlugin();
    const result = transform(plugin, SFC_NO_STYLE, '/src/Plain.utopia')!;
    expect(result.code).not.toContain('.css');
  });

  it('clears stale CSS from the cache when styles are removed', () => {
    const plugin = getPlugin();
    transform(plugin, SFC, '/src/App.utopia');
    expect(load(plugin, '\0/src/App.utopia.css')).toContain('color: red');

    transform(plugin, SFC_NO_STYLE, '/src/App.utopia');
    expect(load(plugin, '\0/src/App.utopia.css')).toBe('');
  });

  it('ignores non-utopia files', () => {
    const plugin = getPlugin();
    expect(transform(plugin, 'const x = 1;', '/src/main.ts')).toBeUndefined();
  });

  it('respects the exclude filter', () => {
    const plugin = getPlugin({ exclude: ['**/skip/**'] });
    expect(transform(plugin, SFC, '/src/skip/App.utopia')).toBeUndefined();
    expect(transform(plugin, SFC, '/src/keep/App.utopia')).toBeDefined();
  });

  it('resolves relative virtual CSS ids against the importer', () => {
    const plugin = getPlugin();
    const resolveId = plugin.resolveId as unknown as AnyHook;
    const resolved = resolveId.call(
      { resolve: () => null },
      './App.utopia.css',
      '/src/pages/index.ts',
    );
    expect(resolved).toBe('\0/src/pages/App.utopia.css');
  });

  it('leaves relative virtual CSS ids unresolved without an importer', () => {
    const plugin = getPlugin();
    const resolveId = plugin.resolveId as unknown as AnyHook;
    expect(resolveId.call({ resolve: () => null }, './App.utopia.css', undefined)).toBeUndefined();
  });
});

// =========================================================================
// HMR
// =========================================================================

interface FakeGraph {
  getModuleById: ReturnType<typeof vi.fn>;
  invalidateModule: ReturnType<typeof vi.fn>;
}

function makeHmrServer(modulesById: Record<string, ModuleNode> = {}): {
  server: HmrContext['server'];
  graph: FakeGraph;
  wsSend: ReturnType<typeof vi.fn>;
} {
  const graph: FakeGraph = {
    getModuleById: vi.fn((id: string) => modulesById[id]),
    invalidateModule: vi.fn(),
  };
  const wsSend = vi.fn();
  const server = {
    moduleGraph: graph,
    ws: { send: wsSend },
  } as unknown as HmrContext['server'];
  return { server, graph, wsSend };
}

function makeCtx(
  file: string,
  source: string,
  server: HmrContext['server'],
  modules: ModuleNode[] = [],
): HmrContext {
  return {
    file,
    read: async () => source,
    server,
    modules,
    timestamp: Date.now(),
  } as HmrContext;
}

const componentModule = { id: '/src/App.utopia' } as unknown as ModuleNode;
const cssModule = { id: '\0/src/App.utopia.css' } as unknown as ModuleNode;

describe('handleHotUpdate', () => {
  it('ignores non-utopia, non-route files', async () => {
    const plugin = getPlugin();
    const { server, wsSend } = makeHmrServer();
    const result = await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/util.ts', 'x', server),
    );
    expect(result).toBeUndefined();
    expect(wsSend).not.toHaveBeenCalled();
  });

  it('invalidates the route table and full-reloads when a route file changes', async () => {
    const plugin = getPlugin();
    const routesModule = { id: '\0virtual:utopia-routes' } as unknown as ModuleNode;
    const { server, graph, wsSend } = makeHmrServer({
      '\0virtual:utopia-routes': routesModule,
    });

    await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/routes/about/+page.ts', 'x', server),
    );

    expect(graph.invalidateModule).toHaveBeenCalledWith(routesModule);
    expect(wsSend).toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('skips the reload when the routes module was never loaded', async () => {
    const plugin = getPlugin();
    const { server, wsSend } = makeHmrServer();
    await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/routes/+layout.ts', 'x', server),
    );
    expect(wsSend).not.toHaveBeenCalled();
  });

  it('returns undefined (full update) when the new source fails to parse', async () => {
    const plugin = getPlugin();
    const { server } = makeHmrServer();
    const result = await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/App.utopia', '<template><p>x</p>', server, [componentModule]),
    );
    expect(result).toBeUndefined();
  });

  it('returns [] for a test-block-only change (no browser refresh)', async () => {
    const plugin = getPlugin();
    const before = `<template><p>x</p></template>\n<test>expect(1).toBe(1)</test>`;
    const after = `<template><p>x</p></template>\n<test>expect(2).toBe(2)</test>`;
    transform(plugin, before, '/src/App.utopia');

    const { server } = makeHmrServer();
    const result = await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/App.utopia', after, server, [componentModule]),
    );
    expect(result).toEqual([]);
  });

  it('returns only the CSS module for a style-only change', async () => {
    const plugin = getPlugin();
    transform(plugin, SFC, '/src/App.utopia');
    const after = SFC.replace('color: red;', 'color: blue;');

    const { server, graph } = makeHmrServer({ '\0/src/App.utopia.css': cssModule });
    const result = await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/App.utopia', after, server, [componentModule, cssModule]),
    );

    expect(result).toEqual([cssModule]);
    expect(graph.invalidateModule).toHaveBeenCalledWith(cssModule);
    // The refreshed CSS is served on the next load.
    expect(load(plugin, '\0/src/App.utopia.css')).toContain('color: blue');
  });

  it('falls back to a full update when the CSS module is not in the graph', async () => {
    const plugin = getPlugin();
    transform(plugin, SFC, '/src/App.utopia');
    const after = SFC.replace('color: red;', 'color: green;');

    const { server, graph } = makeHmrServer();
    const result = await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/App.utopia', after, server, [componentModule]),
    );

    // Style changed but no CSS module found: invalidate the component module.
    expect(graph.invalidateModule).toHaveBeenCalledWith(componentModule);
    expect(result).toContain(componentModule);
  });

  it('invalidates component and CSS modules when template and style change', async () => {
    const plugin = getPlugin();
    transform(plugin, SFC, '/src/App.utopia');
    const after = SFC.replace('Count:', 'Total:').replace('color: red;', 'color: teal;');

    const { server, graph } = makeHmrServer({ '\0/src/App.utopia.css': cssModule });
    const result = await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/App.utopia', after, server, [componentModule]),
    );

    expect(graph.invalidateModule).toHaveBeenCalledWith(componentModule);
    expect(graph.invalidateModule).toHaveBeenCalledWith(cssModule);
    expect(result).toEqual([componentModule, cssModule]);
    expect(load(plugin, '\0/src/App.utopia.css')).toContain('color: teal');
  });

  it('clears the cached CSS when a combined change removes the style block', async () => {
    const plugin = getPlugin();
    transform(plugin, SFC, '/src/App.utopia');
    const after = `<template>\n  <p>Total: {{ count() }}</p>\n</template>\n`;

    const { server } = makeHmrServer({ '\0/src/App.utopia.css': cssModule });
    await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/App.utopia', after, server, [componentModule]),
    );
    expect(load(plugin, '\0/src/App.utopia.css')).toBe('');
  });

  it('falls back to a full update when a style-only change fails to compile', async () => {
    const plugin = getPlugin();
    // SFC-level parse accepts this, but the template compiler throws.
    const brokenA = '<template><div><p>x</div></template>\n<style>p{color:red}</style>';
    const brokenB = '<template><div><p>x</div></template>\n<style>p{color:blue}</style>';

    const { server } = makeHmrServer({ '\0/src/Broken.utopia.css': cssModule });
    // First update establishes the descriptor (and exercises the combined
    // change path where the compile for CSS refresh also fails).
    await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/Broken.utopia', brokenA, server, [componentModule]),
    );
    // Second update is style-only; compile throws, so the plugin must fall
    // through to a full update (undefined) to surface the error overlay.
    const result = await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/Broken.utopia', brokenB, server, [componentModule]),
    );
    expect(result).toBeUndefined();
  });

  it('clears the cached CSS on a style-only change to an empty style block', async () => {
    const plugin = getPlugin();
    transform(plugin, SFC, '/src/App.utopia');
    const after = SFC.replace(/<style>[\s\S]*<\/style>/, '<style></style>');

    const { server } = makeHmrServer({ '\0/src/App.utopia.css': cssModule });
    const result = await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/App.utopia', after, server, [componentModule, cssModule]),
    );
    expect(result).toEqual([cssModule]);
    expect(load(plugin, '\0/src/App.utopia.css')).toBe('');
  });

  it('returns undefined when nothing changed and no modules are affected', async () => {
    const plugin = getPlugin();
    transform(plugin, SFC_NO_STYLE, '/src/Plain.utopia');
    const { server } = makeHmrServer();
    const result = await (plugin.handleHotUpdate as unknown as AnyHook)(
      makeCtx('/src/Plain.utopia', SFC_NO_STYLE, server, []),
    );
    expect(result).toBeUndefined();
  });
});

// =========================================================================
// defineConfig
// =========================================================================

describe('defineConfig', () => {
  it('injects the utopia plugin by default', () => {
    const config = defineConfig();
    const names = (config.plugins as Plugin[]).map((p) => p.name);
    expect(names).toContain('utopia');
  });

  it('does not duplicate a user-supplied utopia plugin', () => {
    const config = defineConfig({ plugins: [utopiaPlugin()] });
    const names = (config.plugins as Plugin[]).map((p) => p.name);
    expect(names.filter((n) => n === 'utopia')).toHaveLength(1);
  });

  it('detects the utopia plugin inside nested plugin arrays (bug fix)', () => {
    const config = defineConfig({ plugins: [[utopiaPlugin()]] });
    const flat = (config.plugins as unknown[]).flat(Infinity) as Plugin[];
    expect(flat.filter((p) => p.name === 'utopia')).toHaveLength(1);
  });

  it('keeps user plugins ahead of nothing (utopia is prepended)', () => {
    const other = { name: 'other' } as Plugin;
    const config = defineConfig({ plugins: [other] });
    const names = (config.plugins as Plugin[]).map((p) => p.name);
    expect(names).toEqual(['utopia', 'other']);
  });

  it('adds .utopia to resolve extensions without duplicating entries', () => {
    const config = defineConfig();
    const extensions = config.resolve!.extensions!;
    expect(extensions).toContain('.utopia');
    expect(new Set(extensions).size).toBe(extensions.length);

    const custom = defineConfig({ resolve: { extensions: ['.js', '.utopia'] } });
    expect(custom.resolve!.extensions).toEqual(['.js', '.utopia']);
  });

  it('excludes utopia packages from optimizeDeps, merging user entries', () => {
    const config = defineConfig({ optimizeDeps: { exclude: ['lodash'] } });
    const exclude = config.optimizeDeps!.exclude!;
    expect(exclude).toContain('lodash');
    expect(exclude).toContain('@matthesketh/utopia-core');
    expect(exclude).toContain('@matthesketh/utopia-runtime');
  });

  it('marks utopia packages noExternal for SSR', () => {
    const config = defineConfig();
    expect(config.ssr!.noExternal).toContain('@matthesketh/utopia-runtime');
  });

  it('preserves unrelated user config', () => {
    const config = defineConfig({ base: '/app/' });
    expect(config.base).toBe('/app/');
  });
});

// =========================================================================
// <style src> — external stylesheet import
// =========================================================================

describe('<style src> external stylesheet', () => {
  const dirs: string[] = [];

  function fixture(css: string): { dir: string; id: string; cssPath: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utopia-style-src-'));
    dirs.push(dir);
    const cssPath = path.join(dir, 'styles.css');
    fs.writeFileSync(cssPath, css);
    return { dir, id: path.join(dir, 'Card.utopia'), cssPath };
  }

  // Minimal Rollup transform context — only addWatchFile is exercised.
  function ctx(): { addWatchFile: (f: string) => void; watched: string[] } {
    const watched: string[] = [];
    return { addWatchFile: (f: string) => watched.push(f), watched };
  }

  it('inlines an external stylesheet and scopes it to the component', () => {
    const { id, cssPath } = fixture('.card { color: red; }');
    const plugin = getPlugin();
    const c = ctx();

    const code =
      `<template><div class="card">hi</div></template>\n` +
      `<style src="./styles.css" scoped></style>`;
    const out = (plugin.transform as unknown as TransformHook).call(c, code, id) as {
      code: string;
    };

    // The component module imports its virtual CSS module.
    expect(out.code).toContain(JSON.stringify(id + '.css'));
    // The external file is watched so edits trigger HMR.
    expect(c.watched).toContain(cssPath);

    // The virtual CSS module serves the SCOPED external rules.
    const css = (plugin.load as unknown as LoadHook).call(null, '\0' + id + '.css') as string;
    expect(css).toMatch(/\.card\[data-u-[0-9a-f]+\]/);
    expect(css).toContain('color: red');
  });

  it('scopes an external stylesheet identically to the same rules written inline', () => {
    const { id } = fixture('.card { color: red; }');
    const plugin = getPlugin();

    (plugin.transform as unknown as TransformHook).call(
      ctx(),
      `<template><div class="card">hi</div></template>\n<style src="./styles.css" scoped></style>`,
      id,
    );
    const external = (plugin.load as unknown as LoadHook).call(null, '\0' + id + '.css') as string;

    // Compiling the same rules inline under the same filename must yield byte-identical CSS.
    const inline = compile(
      `<template><div class="card">hi</div></template>\n<style scoped>.card { color: red; }</style>`,
      { filename: id },
    );
    expect(external.trim()).toBe((inline.css ?? '').trim());
  });

  it('leaves components without a src attribute untouched', () => {
    const { id } = fixture('.unused {}');
    const plugin = getPlugin();
    const c = ctx();
    const code = `<template><div class="x">hi</div></template>\n<style scoped>.x { color: blue; }</style>`;
    (plugin.transform as unknown as TransformHook).call(c, code, id);
    expect(c.watched).toHaveLength(0);
    const css = (plugin.load as unknown as LoadHook).call(null, '\0' + id + '.css') as string;
    expect(css).toContain('color: blue');
  });

  it('throws a clear error when the external stylesheet cannot be read', () => {
    const id = path.join(os.tmpdir(), 'Missing.utopia');
    const plugin = getPlugin();
    const code = `<template><div>x</div></template>\n<style src="./does-not-exist.css" scoped></style>`;
    expect(() => (plugin.transform as unknown as TransformHook).call(ctx(), code, id)).toThrow(
      /could not be read/,
    );
  });
});

// =========================================================================
// <include src> — compile-time template fragments
// =========================================================================

describe('<include src> template fragments', () => {
  const SCRIPT = `\n<script>\nexport function title() {\n  return 'hi';\n}\n</script>`;

  function fixtureDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'utopia-include-'));
  }

  function ctx(): { addWatchFile: (f: string) => void; watched: string[] } {
    const watched: string[] = [];
    return { addWatchFile: (f: string) => watched.push(f), watched };
  }

  it('inlines a fragment with byte-identical output to the same markup written inline', () => {
    const dir = fixtureDir();
    const frag = '<span class="t">{{ title() }}</span>';
    fs.writeFileSync(path.join(dir, 'frag.uhtml'), frag);
    const id = path.join(dir, 'Card.utopia');

    const includeSrc = `<template><div class="wrap"><include src="./frag.uhtml" /></div></template>${SCRIPT}`;
    const inlineSrc = `<template><div class="wrap">${frag}</div></template>${SCRIPT}`;

    const plugin = getPlugin();
    const c = ctx();
    const out = (plugin.transform as unknown as TransformHook).call(c, includeSrc, id) as {
      code: string;
    };

    // the fragment is compiled into the parent's own render function.
    expect(out.code).toBe(compile(inlineSrc, { filename: id }).code);
    // and the fragment file is watched for HMR.
    expect(c.watched).toContain(path.join(dir, 'frag.uhtml'));
  });

  it('supports the paired <include src="..."></include> form', () => {
    const dir = fixtureDir();
    fs.writeFileSync(path.join(dir, 'frag.uhtml'), '<b>x</b>');
    const id = path.join(dir, 'Card.utopia');
    const src = `<template><div><include src="./frag.uhtml"></include></div></template>${SCRIPT}`;
    const inlineSrc = `<template><div><b>x</b></div></template>${SCRIPT}`;
    const plugin = getPlugin();
    const out = (plugin.transform as unknown as TransformHook).call(ctx(), src, id) as {
      code: string;
    };
    expect(out.code).toBe(compile(inlineSrc, { filename: id }).code);
  });

  it('resolves nested includes relative to each fragment', () => {
    const dir = fixtureDir();
    fs.mkdirSync(path.join(dir, 'parts'));
    fs.writeFileSync(path.join(dir, 'parts', 'inner.uhtml'), '<i>deep</i>');
    fs.writeFileSync(
      path.join(dir, 'outer.uhtml'),
      '<div class="o"><include src="./parts/inner.uhtml" /></div>',
    );
    const id = path.join(dir, 'Card.utopia');
    const src = `<template><section><include src="./outer.uhtml" /></section></template>${SCRIPT}`;
    const inlineSrc = `<template><section><div class="o"><i>deep</i></div></section></template>${SCRIPT}`;
    const plugin = getPlugin();
    const c = ctx();
    const out = (plugin.transform as unknown as TransformHook).call(c, src, id) as { code: string };
    expect(out.code).toBe(compile(inlineSrc, { filename: id }).code);
    expect(c.watched).toContain(path.join(dir, 'outer.uhtml'));
    expect(c.watched).toContain(path.join(dir, 'parts', 'inner.uhtml'));
  });

  it('throws on a circular include', () => {
    const dir = fixtureDir();
    fs.writeFileSync(path.join(dir, 'a.uhtml'), '<div><include src="./b.uhtml" /></div>');
    fs.writeFileSync(path.join(dir, 'b.uhtml'), '<div><include src="./a.uhtml" /></div>');
    const id = path.join(dir, 'Card.utopia');
    const src = `<template><include src="./a.uhtml" /></template>${SCRIPT}`;
    const plugin = getPlugin();
    expect(() => (plugin.transform as unknown as TransformHook).call(ctx(), src, id)).toThrow(
      /circular/,
    );
  });

  it('throws a clear error when a fragment cannot be read', () => {
    const id = path.join(os.tmpdir(), 'Missing.utopia');
    const src = `<template><include src="./nope.uhtml" /></template>${SCRIPT}`;
    const plugin = getPlugin();
    expect(() => (plugin.transform as unknown as TransformHook).call(ctx(), src, id)).toThrow(
      /could not be read/,
    );
  });

  it('leaves components without includes untouched', () => {
    const dir = fixtureDir();
    const id = path.join(dir, 'Plain.utopia');
    const src = `<template><div>plain</div></template>${SCRIPT}`;
    const plugin = getPlugin();
    const c = ctx();
    const out = (plugin.transform as unknown as TransformHook).call(c, src, id) as { code: string };
    expect(out.code).toBe(compile(src, { filename: id }).code);
    expect(c.watched).toHaveLength(0);
  });
});
