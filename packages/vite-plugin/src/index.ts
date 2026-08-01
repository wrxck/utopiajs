import fs from 'node:fs';
import path from 'node:path';

import { compile, parse, type SFCBlock } from '@matthesketh/utopia-compiler';
import type { HmrContext, ModuleNode, Plugin, UserConfig } from 'vite';
import { createFilter, type FilterPattern } from 'vite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for the UtopiaJS Vite plugin.
 */
export interface UtopiaPluginOptions {
  /**
   * Glob patterns to include when transforming `.utopia` files.
   * @default '**\/*.utopia'
   */
  include?: FilterPattern;

  /**
   * Glob patterns to exclude from transformation.
   * @default undefined
   */
  exclude?: FilterPattern;

  /**
   * Directory containing route files, relative to the project root.
   * @default 'src/routes'
   */
  routesDir?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extension for Utopia single-file components. */
const UTOPIA_EXT = '.utopia';

/**
 * Suffix appended to `.utopia` file ids to produce virtual CSS module ids.
 * For example `./App.utopia` generates the virtual id `./App.utopia.css`.
 */
const CSS_SUFFIX = '.css';

/**
 * Prefix used for Vite virtual module resolution.
 * @see https://vitejs.dev/guide/api-plugin#virtual-modules-convention
 */
const VIRTUAL_PREFIX = '\0';

/** Virtual module ID for the route table. */
const VIRTUAL_ROUTES_ID = 'virtual:utopia-routes';

/** Resolved virtual module ID (with \0 prefix). */
const RESOLVED_VIRTUAL_ROUTES_ID = VIRTUAL_PREFIX + VIRTUAL_ROUTES_ID;

/** Pattern matching route special files for HMR invalidation. */
const ROUTE_FILE_RE = /\+(?:page|layout|error|server)\.\w+$/;

// ---------------------------------------------------------------------------
// External dependency index
// ---------------------------------------------------------------------------

/**
 * Reverse index mapping an external file's absolute path (a `<style src>`
 * stylesheet or a `<include src>` template fragment) to the set of `.utopia`
 * files that pull it in. Populated during `transform` and consulted in
 * `handleHotUpdate` so that editing a shared external file hot-updates every
 * component that references it.
 *
 * This stays at module scope because `registerExternalDep` is a module-level
 * helper. The CSS cache, by contrast, lives inside the plugin factory so two
 * plugin instances in one process cannot see each other's stylesheets.
 */
const externalDepOwners = new Map<string, Set<string>>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the virtual CSS module id for a given `.utopia` file.
 *
 * @param utopiaId - Absolute path to the `.utopia` file.
 * @returns The virtual CSS id (e.g. `/abs/path/App.utopia.css`).
 */
function toCssId(utopiaId: string): string {
  return utopiaId + CSS_SUFFIX;
}

/**
 * Check whether a module id refers to a virtual utopia CSS module.
 */
function isVirtualCssId(id: string): boolean {
  return id.endsWith(UTOPIA_EXT + CSS_SUFFIX);
}

/**
 * Strip the `\0` virtual prefix if present.
 */
function stripVirtualPrefix(id: string): string {
  return id.startsWith(VIRTUAL_PREFIX) ? id.slice(VIRTUAL_PREFIX.length) : id;
}

/**
 * Recover the `.utopia` source path from a virtual CSS id.
 */
function cssIdToUtopiaId(cssId: string): string {
  const raw = stripVirtualPrefix(cssId);
  // Remove the trailing `.css`
  return raw.slice(0, -CSS_SUFFIX.length);
}

// ---------------------------------------------------------------------------
// External stylesheet (`<style src>`) inlining
// ---------------------------------------------------------------------------

/**
 * If the component's `<style>` block references an external file via a `src`
 * attribute, read that file and splice its content into the block *before*
 * compilation, dropping the `src` attribute but preserving every other one
 * (`scoped`, `lang`, …).
 *
 * The scope id is derived from the `.utopia` filename — not from the CSS
 * text or its location — so an inlined external stylesheet is scoped
 * byte-for-byte identically to the same rules written in place. This is what
 * lets a component keep its CSS in a sibling `.css` file with no change in
 * behaviour.
 *
 * @param code - The raw `.utopia` source.
 * @param id - Absolute path to the `.utopia` file (used as the scope seed).
 * @returns The rewritten source and the absolute path of the stylesheet it
 *   pulled in, or `null` when the block has no `src`.
 */
function inlineStyleSrc(code: string, id: string): { code: string; dep: string } | null {
  let descriptor: ReturnType<typeof parse>;
  try {
    descriptor = parse(code, id);
  } catch {
    // Let compile() surface the parse error with proper positioning.
    return null;
  }

  const style = descriptor.style;
  const src = style?.attrs.src;
  if (!style || typeof src !== 'string' || src.length === 0) return null;

  const dep = path.isAbsolute(src) ? src : path.resolve(path.dirname(id), src);

  let external: string;
  try {
    external = fs.readFileSync(dep, 'utf8');
  } catch {
    throw new Error(
      `[utopia] <style src="${src}"> in ${id} could not be read (resolved to ${dep}).`,
    );
  }

  // Reconstruct the opening tag from the parsed attributes minus `src`, so
  // scoping/preprocessor flags carry through unchanged.
  const attrs = Object.entries(style.attrs)
    .filter(([name]) => name !== 'src')
    .map(([name, value]) => (value === true ? name : `${name}="${value as string}"`))
    .join(' ');
  const openTag = attrs ? `<style ${attrs}>` : '<style>';
  const block = `${openTag}${external}${style.content}</style>`;

  const rewritten = code.slice(0, style.start) + block + code.slice(style.end);
  return { code: rewritten, dep };
}

// ---------------------------------------------------------------------------
// External template fragments (`<include src>`) inlining
// ---------------------------------------------------------------------------

/** Matches `<include src="…" />` and `<include src="…"></include>` (empty). */
const INCLUDE_RE = /<include\b([^>]*?)\s*\/>|<include\b([^>]*?)\s*>\s*<\/include>/g;

/** Pull the `src` value out of an include tag's raw attribute string. */
function includeSrc(attrs: string): string | null {
  const m = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/**
 * Recursively replace every `<include src>` in a template string with the
 * referenced fragment's contents. Fragments may themselves contain includes,
 * resolved relative to the fragment's own directory. A cycle throws.
 *
 * @param text - Template markup to process.
 * @param baseDir - Directory that relative `src` values resolve against.
 * @param deps - Accumulates every fragment path pulled in (for watch / HMR).
 * @param chain - The include chain guarding against cycles.
 */
function inlineIncludeText(
  text: string,
  baseDir: string,
  deps: Set<string>,
  chain: string[],
): string {
  return text.replace(INCLUDE_RE, (whole, a1, a2) => {
    const src = includeSrc(String(a1 ?? a2 ?? ''));
    if (!src) return whole; // an <include> without a src — leave for the compiler
    const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
    if (chain.includes(abs)) {
      throw new Error(
        `[utopia] circular <include src="${src}"> (chain: ${[...chain, abs].join(' -> ')}).`,
      );
    }
    let fragment: string;
    try {
      fragment = fs.readFileSync(abs, 'utf8');
    } catch {
      throw new Error(`[utopia] <include src="${src}"> could not be read (resolved to ${abs}).`);
    }
    deps.add(abs);
    return inlineIncludeText(fragment, path.dirname(abs), deps, [...chain, abs]);
  });
}

/**
 * If the component's `<template>` block contains `<include src>` directives,
 * splice each referenced fragment in place *before* compilation. Because the
 * fragment is compiled as part of the parent's single render function — against
 * the parent's script scope, with no component boundary — its rendering and
 * reactivity are byte-for-byte identical to writing the markup inline. This is
 * what lets a component pull repeated or bulky markup out into a shared
 * `.uhtml` fragment with no change in behaviour.
 *
 * @returns The rewritten source and the fragment paths it pulled in, or `null`
 *   when the template has no includes.
 */
function inlineTemplateIncludes(code: string, id: string): { code: string; deps: string[] } | null {
  let descriptor: ReturnType<typeof parse>;
  try {
    descriptor = parse(code, id);
  } catch {
    return null;
  }

  const tpl = descriptor.template;
  if (!tpl || !/<include\b/.test(tpl.content)) return null;

  const deps = new Set<string>();
  const newContent = inlineIncludeText(tpl.content, path.dirname(id), deps, [id]);
  if (deps.size === 0) return null;

  const attrs = Object.entries(tpl.attrs)
    .map(([name, value]) => (value === true ? name : `${name}="${value as string}"`))
    .join(' ');
  const openTag = attrs ? `<template ${attrs}>` : '<template>';
  const rewritten =
    code.slice(0, tpl.start) + `${openTag}${newContent}</template>` + code.slice(tpl.end);
  return { code: rewritten, deps: [...deps] };
}

/**
 * Compile a `.utopia` source, first inlining any `<include src>` template
 * fragments and any `<style src>` external stylesheet. Returns the compile
 * result plus every external file path pulled in, so the caller can register
 * them for HMR / watching.
 */
function compileUtopiaSource(
  code: string,
  id: string,
): { result: ReturnType<typeof compile>; deps: string[] } {
  const deps: string[] = [];
  let source = code;

  const includes = inlineTemplateIncludes(source, id);
  if (includes) {
    source = includes.code;
    deps.push(...includes.deps);
  }

  const style = inlineStyleSrc(source, id);
  if (style) {
    source = style.code;
    deps.push(style.dep);
  }

  return { result: compile(source, { filename: id }), deps };
}

/**
 * Record that `utopiaId` pulls in the external file at `dep` (stylesheet or
 * template fragment).
 */
function registerExternalDep(dep: string, utopiaId: string): void {
  let set = externalDepOwners.get(dep);
  if (!set) {
    set = new Set<string>();
    externalDepOwners.set(dep, set);
  }
  set.add(utopiaId);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Vite plugin for UtopiaJS.
 *
 * Transforms `.utopia` single-file components using `@matthesketh/utopia-compiler`,
 * extracts and injects CSS through Vite's virtual module pipeline, and
 * provides granular HMR support (style-only hot updates when only the
 * `<style>` block changes).
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import utopia from '@matthesketh/utopia-vite-plugin'
 *
 * export default {
 *   plugins: [utopia()],
 * }
 * ```
 *
 * @param options - Optional configuration.
 * @returns A Vite plugin object.
 */
export default function utopiaPlugin(options: UtopiaPluginOptions = {}): Plugin {
  const { include = `**/*${UTOPIA_EXT}`, exclude, routesDir = 'src/routes' } = options;

  let filter: (id: string) => boolean;

  /**
   * In-memory cache that maps a `.utopia` file path to its most recently
   * extracted CSS string.  The cache is shared between the `transform` and
   * `resolveId` / `load` hooks so that the virtual CSS module can serve the
   * correct stylesheet content.
   */
  const cssCache = new Map<string, string>();

  /**
   * Track the previous SFC descriptor per file so we can diff blocks for
   * granular HMR.
   */
  const prevDescriptors = new Map<string, ReturnType<typeof parse>>();

  return {
    name: 'utopia',

    /**
     * Enforce the plugin to run before Vite's internal transforms so that
     * `.utopia` files are compiled before any further processing.
     */
    enforce: 'pre',

    // -------------------------------------------------------------------
    // Config — SSR alias resolution
    // -------------------------------------------------------------------

    config(userConfig, env) {
      if (env.isSsrBuild) {
        return {
          resolve: {
            alias: {
              '@matthesketh/utopia-runtime': '@matthesketh/utopia-server/ssr-runtime',
            },
          },
        };
      }
    },

    configResolved() {
      filter = createFilter(include, exclude);
    },

    // -------------------------------------------------------------------
    // Resolve virtual CSS modules + SSR runtime alias
    // -------------------------------------------------------------------

    resolveId(id, importer, options) {
      // Virtual routes module.
      if (id === VIRTUAL_ROUTES_ID) {
        return RESOLVED_VIRTUAL_ROUTES_ID;
      }

      // During dev SSR (`ssrLoadModule`), env.isSsrBuild is false so the
      // config hook alias does not apply. Intercept `@matthesketh/utopia-runtime`
      // imports when resolved for SSR and redirect to the SSR runtime.
      if (options?.ssr && id === '@matthesketh/utopia-runtime') {
        return this.resolve('@matthesketh/utopia-server/ssr-runtime', importer, {
          skipSelf: true,
          ...options,
        });
      }

      // Handle virtual CSS ids that originate from `.utopia` compiled output.
      if (isVirtualCssId(id)) {
        // If the id is already absolute, just add the virtual prefix.
        if (path.isAbsolute(id)) {
          return VIRTUAL_PREFIX + id;
        }

        // Relative import – resolve against importer directory.
        if (importer) {
          const dir = path.dirname(importer);
          const resolved = path.resolve(dir, id);
          return VIRTUAL_PREFIX + resolved;
        }
      }

      return undefined;
    },

    // -------------------------------------------------------------------
    // Load virtual CSS modules
    // -------------------------------------------------------------------

    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return undefined;

      // Virtual routes module.
      if (id === RESOLVED_VIRTUAL_ROUTES_ID) {
        const globPattern = `/${routesDir}/**/+{page,layout,error,server}.{utopia,ts,js}`;
        return [
          `import { buildRouteTable } from '@matthesketh/utopia-router';`,
          `const manifest = import.meta.glob(${JSON.stringify(globPattern)});`,
          `const apiManifest = import.meta.glob('/${routesDir}/**/+server.{ts,js}');`,
          `const routes = buildRouteTable(manifest);`,
          `export default routes;`,
          `export { routes, apiManifest };`,
        ].join('\n');
      }

      const raw = stripVirtualPrefix(id);

      if (isVirtualCssId(raw)) {
        const utopiaId = cssIdToUtopiaId(raw);
        const css = cssCache.get(utopiaId) ?? '';
        return css;
      }

      return undefined;
    },

    // -------------------------------------------------------------------
    // Transform .utopia files
    // -------------------------------------------------------------------

    transform(code, id) {
      if (!id.endsWith(UTOPIA_EXT)) return undefined;
      if (!filter(id)) return undefined;

      // Inline any `<include src>` template fragments and `<style src>`
      // stylesheet before compiling, and register each external file so Vite
      // watches it and HMR can find the owning component.
      const { result, deps } = compileUtopiaSource(code, id);
      for (const dep of deps) {
        registerExternalDep(dep, id);
        this.addWatchFile(dep);
      }

      // Cache the extracted CSS for the virtual module.
      if (result.css) {
        cssCache.set(id, result.css);
      } else {
        cssCache.delete(id);
      }

      // Store the parsed descriptor for HMR diffing.
      try {
        const descriptor = parse(code, id);
        prevDescriptors.set(id, descriptor);
      } catch {
        // Parsing failures are non-fatal for the descriptor cache –
        // the compile call above will surface errors properly.
      }

      // Build the final module code.  If the component has styles we
      // append a CSS import so that Vite picks up the virtual module
      // and processes it through its CSS pipeline (postcss etc).
      let output = result.code;
      if (result.css) {
        const cssImportId = toCssId(id);
        output += `\nimport ${JSON.stringify(cssImportId)};\n`;
      }

      return {
        code: output,
        map: null,
      };
    },

    // -------------------------------------------------------------------
    // HMR
    // -------------------------------------------------------------------

    handleHotUpdate(ctx: HmrContext) {
      const { file, read, server: hmrServer, modules } = ctx;

      // When a route special file (+page, +layout, +error, +server) is
      // added/removed/renamed, invalidate the virtual routes module and
      // trigger a full reload so the route table is rebuilt.
      if (ROUTE_FILE_RE.test(file)) {
        const routesMod = hmrServer.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ROUTES_ID);
        if (routesMod) {
          hmrServer.moduleGraph.invalidateModule(routesMod);
          hmrServer.ws.send({ type: 'full-reload' });
        }
      }

      // When an external file pulled in via `<style src>` or `<include src>`
      // changes, recompile every component that references it. A stylesheet
      // edit hot-updates just the virtual CSS module (style-only, no
      // re-render); a template fragment edit re-renders the owning component.
      const owners = externalDepOwners.get(file);
      if (owners && owners.size > 0) {
        const isStyleDep = /\.(css|scss|sass)$/i.test(file);
        const affected: ModuleNode[] = [];
        for (const utopiaId of owners) {
          let utopiaCode: string;
          try {
            utopiaCode = fs.readFileSync(utopiaId, 'utf8');
          } catch {
            // Owning component was removed — drop it and carry on.
            owners.delete(utopiaId);
            continue;
          }

          try {
            const { result } = compileUtopiaSource(utopiaCode, utopiaId);
            if (result.css) {
              cssCache.set(utopiaId, result.css);
            } else {
              cssCache.delete(utopiaId);
            }
          } catch {
            // Compile/read error — skip; a later edit will resurface it.
          }

          const cssId = VIRTUAL_PREFIX + toCssId(utopiaId);
          const cssModule = hmrServer.moduleGraph.getModuleById(cssId);
          if (cssModule) {
            hmrServer.moduleGraph.invalidateModule(cssModule);
            affected.push(cssModule);
          }

          // A template fragment change alters the render output, so the
          // component module itself must re-run — not just its stylesheet.
          if (!isStyleDep) {
            for (const mod of hmrServer.moduleGraph.getModulesByFile(utopiaId) ?? []) {
              hmrServer.moduleGraph.invalidateModule(mod);
              affected.push(mod);
            }
          }
        }
        if (affected.length > 0) return affected;
      }

      if (!file.endsWith(UTOPIA_EXT)) return undefined;

      return (async () => {
        const source = await read();

        // ------------------------------------------------------------------
        // Parse the new descriptor and compare with the previous one.
        // ------------------------------------------------------------------
        let newDescriptor: ReturnType<typeof parse>;
        try {
          newDescriptor = parse(source, file);
        } catch {
          // If parsing fails, fall through to a full update so the user
          // sees the compile error in the browser overlay.
          return undefined;
        }

        const oldDescriptor = prevDescriptors.get(file);
        prevDescriptors.set(file, newDescriptor);

        // ------------------------------------------------------------------
        // Determine what changed.
        // ------------------------------------------------------------------
        const templateChanged = didBlockChange(oldDescriptor?.template, newDescriptor.template);
        const scriptChanged = didBlockChange(oldDescriptor?.script, newDescriptor.script);
        const styleChanged = didBlockChange(oldDescriptor?.style, newDescriptor.style);
        const testChanged = didBlockChange(oldDescriptor?.test, newDescriptor.test);

        // ------------------------------------------------------------------
        // Test-only change  -->  skip browser refresh entirely.
        // ------------------------------------------------------------------
        if (testChanged && !templateChanged && !scriptChanged && !styleChanged) {
          return [];
        }

        // ------------------------------------------------------------------
        // Style-only change  -->  update only the virtual CSS module.
        // ------------------------------------------------------------------
        if (styleChanged && !templateChanged && !scriptChanged) {
          // Re-compile to refresh the CSS cache.
          let result: ReturnType<typeof compile>;
          try {
            const compiled = compileUtopiaSource(source, file);
            result = compiled.result;
            for (const dep of compiled.deps) {
              registerExternalDep(dep, file);
            }
          } catch {
            // Compile error — fall through to full update so the user
            // sees the error in the browser overlay.
            return undefined;
          }

          if (result.css) {
            cssCache.set(file, result.css);
          } else {
            cssCache.delete(file);
          }

          // Find the virtual CSS module in the module graph and invalidate it.
          const cssId = VIRTUAL_PREFIX + toCssId(file);
          const cssModule = hmrServer.moduleGraph.getModuleById(cssId);

          if (cssModule) {
            hmrServer.moduleGraph.invalidateModule(cssModule);
            // Return only the CSS module so Vite sends a style-only HMR
            // update (no component re-render).
            return [cssModule];
          }
        }

        // ------------------------------------------------------------------
        // Template or script changed  -->  full component re-render.
        // ------------------------------------------------------------------
        // Invalidate both the component module and the CSS module.
        const affectedModules: ModuleNode[] = [];

        for (const mod of modules) {
          hmrServer.moduleGraph.invalidateModule(mod);
          affectedModules.push(mod);
        }

        // Also invalidate the CSS module so it picks up any concurrent
        // style changes.
        if (styleChanged) {
          try {
            const { result, deps } = compileUtopiaSource(source, file);
            for (const dep of deps) {
              registerExternalDep(dep, file);
            }
            if (result.css) {
              cssCache.set(file, result.css);
            } else {
              cssCache.delete(file);
            }
          } catch {
            // Compile error — the component module update will surface
            // the error through Vite's transform pipeline.
          }

          const cssId = VIRTUAL_PREFIX + toCssId(file);
          const cssModule = hmrServer.moduleGraph.getModuleById(cssId);
          if (cssModule) {
            hmrServer.moduleGraph.invalidateModule(cssModule);
            affectedModules.push(cssModule);
          }
        }

        return affectedModules.length > 0 ? affectedModules : undefined;
      })();
    },
  };
}

// ---------------------------------------------------------------------------
// Block comparison helper
// ---------------------------------------------------------------------------

/**
 * Shallow comparison of SFC blocks.  Returns `true` when the content of
 * the two blocks differs (or one is present while the other is not).
 */
function didBlockChange(
  oldBlock: SFCBlock | undefined | null,
  newBlock: SFCBlock | undefined | null,
): boolean {
  if (!oldBlock && !newBlock) return false;
  if (!oldBlock || !newBlock) return true;
  return oldBlock.content !== newBlock.content;
}

// ---------------------------------------------------------------------------
// defineConfig helper
// ---------------------------------------------------------------------------

/**
 * Create a Vite configuration pre-configured for an UtopiaJS project.
 *
 * Merges the Utopia Vite plugin and sensible defaults into an optional
 * user-provided Vite configuration.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from '@matthesketh/utopia-vite-plugin'
 *
 * export default defineConfig({
 *   // your overrides here
 * })
 * ```
 *
 * @param userConfig - Optional Vite `UserConfig` to merge.
 * @returns A complete Vite `UserConfig` ready to use.
 */
export function defineConfig(userConfig: UserConfig = {}): UserConfig {
  const {
    plugins: userPlugins = [],
    resolve: userResolve,
    optimizeDeps: userOptimizeDeps,
    ...rest
  } = userConfig;

  // Check whether the user already included the utopia plugin. Plugin
  // entries may be arbitrarily nested arrays (presets), so flatten first.
  const hasUtopiaPlugin = (userPlugins as unknown[])
    .flat(Infinity)
    .some((p) => p != null && typeof p === 'object' && 'name' in p && p.name === 'utopia');

  const plugins: Plugin[] = hasUtopiaPlugin
    ? (userPlugins as Plugin[])
    : [utopiaPlugin(), ...(userPlugins as Plugin[])];

  return {
    ...rest,

    plugins,

    resolve: {
      ...userResolve,
      // Ensure `.utopia` is resolvable as an extension so bare imports work
      // (e.g. `import App from './App'` resolves to `./App.utopia`).
      extensions: mergeUnique(
        userResolve?.extensions ?? ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
        [UTOPIA_EXT],
      ),
    },

    optimizeDeps: {
      ...userOptimizeDeps,
      // Exclude UtopiaJS packages from Vite's dependency pre-bundling so
      // they go through the normal plugin pipeline.
      exclude: mergeUnique(userOptimizeDeps?.exclude ?? [], [
        '@matthesketh/utopia-core',
        '@matthesketh/utopia-runtime',
        '@matthesketh/utopia-router',
        '@matthesketh/utopia-server',
      ]),
    },

    ssr: {
      // Ensure UtopiaJS packages are bundled during SSR builds so the
      // runtime swap alias is applied correctly.
      noExternal: [
        '@matthesketh/utopia-core',
        '@matthesketh/utopia-runtime',
        '@matthesketh/utopia-router',
        '@matthesketh/utopia-server',
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Merge two string arrays, deduplicating entries.
 */
function mergeUnique(base: string[], additions: string[]): string[] {
  const set = new Set([...base, ...additions]);
  return [...set];
}
