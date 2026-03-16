// @vitest-environment node
// ============================================================================
// @matthesketh/utopia-vite-plugin — Test suite
// ============================================================================

import { describe, it, expect } from 'vitest';
import utopiaPlugin from './index.js';
import type { Plugin } from 'vite';

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
    expect(code).toContain("import.meta.glob");
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
