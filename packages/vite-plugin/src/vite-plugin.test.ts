// @vitest-environment node
// ============================================================================
// @matthesketh/utopia-vite-plugin — Test suite
// ============================================================================

import { describe, it, expect } from 'vitest';
import utopiaPlugin from '@/index';
import { compile } from '@matthesketh/utopia-compiler';
import type { Plugin } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Helper to extract the plugin hooks from the returned plugin object.
function getPlugin(options?: Parameters<typeof utopiaPlugin>[0]): Plugin {
  const plugin = utopiaPlugin(options);
  // configResolved must be called to set up the filter.
  if (typeof plugin.configResolved === 'function') {
    (plugin.configResolved as Function)({ plugins: [] });
  }
  return plugin;
}

// =========================================================================
// Virtual routes module
// =========================================================================

describe('virtual:utopia-routes', () => {
  it('resolves virtual:utopia-routes to the prefixed ID', () => {
    const plugin = getPlugin();
    const resolveId = plugin.resolveId as Function;
    const result = resolveId.call({ resolve: () => null }, 'virtual:utopia-routes');
    expect(result).toBe('\0virtual:utopia-routes');
  });

  it('loads virtual routes module with correct glob pattern', () => {
    const plugin = getPlugin();
    const load = plugin.load as Function;
    const code = load('\0virtual:utopia-routes');
    expect(code).toContain('import { buildRouteTable }');
    expect(code).toContain('import.meta.glob');
    expect(code).toContain('+{page,layout,error,server}');
    expect(code).toContain('src/routes');
    expect(code).toContain('export default routes');
    expect(code).toContain('apiManifest');
  });

  it('respects custom routesDir option', () => {
    const plugin = getPlugin({ routesDir: 'app/pages' });
    const load = plugin.load as Function;
    const code = load('\0virtual:utopia-routes');
    expect(code).toContain('app/pages');
    expect(code).not.toContain('src/routes');
  });

  it('does not resolve unrelated virtual modules', () => {
    const plugin = getPlugin();
    const resolveId = plugin.resolveId as Function;
    const result = resolveId.call({ resolve: () => null }, 'virtual:other');
    expect(result).toBeUndefined();
  });

  it('does not load unrelated virtual modules', () => {
    const plugin = getPlugin();
    const load = plugin.load as Function;
    const result = load('\0virtual:other');
    expect(result).toBeUndefined();
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
    const out = (plugin.transform as Function).call(c, code, id) as { code: string };

    // The component module imports its virtual CSS module.
    expect(out.code).toContain(JSON.stringify(id + '.css'));
    // The external file is watched so edits trigger HMR.
    expect(c.watched).toContain(cssPath);

    // The virtual CSS module serves the SCOPED external rules.
    const css = (plugin.load as Function).call(null, '\0' + id + '.css') as string;
    expect(css).toMatch(/\.card\[data-u-[0-9a-f]+\]/);
    expect(css).toContain('color: red');
  });

  it('scopes an external stylesheet identically to the same rules written inline', () => {
    const { id } = fixture('.card { color: red; }');
    const plugin = getPlugin();

    (plugin.transform as Function).call(
      ctx(),
      `<template><div class="card">hi</div></template>\n<style src="./styles.css" scoped></style>`,
      id,
    );
    const external = (plugin.load as Function).call(null, '\0' + id + '.css') as string;

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
    const out = (plugin.transform as Function).call(c, code, id) as { code: string };
    expect(c.watched).toHaveLength(0);
    const css = (plugin.load as Function).call(null, '\0' + id + '.css') as string;
    expect(css).toContain('color: blue');
  });

  it('throws a clear error when the external stylesheet cannot be read', () => {
    const id = path.join(os.tmpdir(), 'Missing.utopia');
    const plugin = getPlugin();
    const code = `<template><div>x</div></template>\n<style src="./does-not-exist.css" scoped></style>`;
    expect(() => (plugin.transform as Function).call(ctx(), code, id)).toThrow(/could not be read/);
  });
});
