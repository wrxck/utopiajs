import type { Plugin, UserConfig, ViteDevServer, ModuleNode, HmrContext } from 'vite'
import { compile, parse, type SFCBlock } from '@matthesketh/utopia-compiler'
import { createFilter, type FilterPattern } from 'vite'
import path from 'node:path'

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
  include?: FilterPattern

  /**
   * Glob patterns to exclude from transformation.
   * @default undefined
   */
  exclude?: FilterPattern

}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extension for Utopia single-file components. */
const UTOPIA_EXT = '.utopia'

/**
 * Suffix appended to `.utopia` file ids to produce virtual CSS module ids.
 * For example `./App.utopia` generates the virtual id `./App.utopia.css`.
 */
const CSS_SUFFIX = '.css'

/**
 * Prefix used for Vite virtual module resolution.
 * @see https://vitejs.dev/guide/api-plugin#virtual-modules-convention
 */
const VIRTUAL_PREFIX = '\0'

// ---------------------------------------------------------------------------
// CSS cache
// ---------------------------------------------------------------------------

/**
 * In-memory cache that maps a `.utopia` file path to its most recently
 * extracted CSS string.  The cache is shared between the `transform` and
 * `resolveId` / `load` hooks so that the virtual CSS module can serve the
 * correct stylesheet content.
 */
const cssCache = new Map<string, string>()

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
  return utopiaId + CSS_SUFFIX
}

/**
 * Check whether a module id refers to a virtual utopia CSS module.
 */
function isVirtualCssId(id: string): boolean {
  return id.endsWith(UTOPIA_EXT + CSS_SUFFIX)
}

/**
 * Strip the `\0` virtual prefix if present.
 */
function stripVirtualPrefix(id: string): string {
  return id.startsWith(VIRTUAL_PREFIX) ? id.slice(VIRTUAL_PREFIX.length) : id
}

/**
 * Recover the `.utopia` source path from a virtual CSS id.
 */
function cssIdToUtopiaId(cssId: string): string {
  const raw = stripVirtualPrefix(cssId)
  // Remove the trailing `.css`
  return raw.slice(0, -CSS_SUFFIX.length)
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
  const {
    include = `**/*${UTOPIA_EXT}`,
    exclude,
  } = options

  let filter: (id: string) => boolean
  let server: ViteDevServer | undefined

  /**
   * Track the previous SFC descriptor per file so we can diff blocks for
   * granular HMR.
   */
  const prevDescriptors = new Map<string, ReturnType<typeof parse>>()

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
        }
      }
    },

    configResolved() {
      filter = createFilter(include, exclude)
    },

    // -------------------------------------------------------------------
    // Dev server – store reference for HMR
    // -------------------------------------------------------------------

    configureServer(_server) {
      server = _server
    },

    // -------------------------------------------------------------------
    // Resolve virtual CSS modules + SSR runtime alias
    // -------------------------------------------------------------------

    resolveId(id, importer, options) {
      // During dev SSR (`ssrLoadModule`), env.isSsrBuild is false so the
      // config hook alias does not apply. Intercept `@matthesketh/utopia-runtime`
      // imports when resolved for SSR and redirect to the SSR runtime.
      if (options?.ssr && id === '@matthesketh/utopia-runtime') {
        return this.resolve('@matthesketh/utopia-server/ssr-runtime', importer, {
          skipSelf: true,
          ...options,
        })
      }

      // Handle virtual CSS ids that originate from `.utopia` compiled output.
      if (isVirtualCssId(id)) {
        // If the id is already absolute, just add the virtual prefix.
        if (path.isAbsolute(id)) {
          return VIRTUAL_PREFIX + id
        }

        // Relative import – resolve against importer directory.
        if (importer) {
          const dir = path.dirname(importer)
          const resolved = path.resolve(dir, id)
          return VIRTUAL_PREFIX + resolved
        }
      }

      return undefined
    },

    // -------------------------------------------------------------------
    // Load virtual CSS modules
    // -------------------------------------------------------------------

    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return undefined

      const raw = stripVirtualPrefix(id)

      if (isVirtualCssId(raw)) {
        const utopiaId = cssIdToUtopiaId(raw)
        const css = cssCache.get(utopiaId) ?? ''
        return css
      }

      return undefined
    },

    // -------------------------------------------------------------------
    // Transform .utopia files
    // -------------------------------------------------------------------

    transform(code, id) {
      if (!id.endsWith(UTOPIA_EXT)) return undefined
      if (!filter(id)) return undefined

      const result = compile(code, {
        filename: id,
      })

      // Cache the extracted CSS for the virtual module.
      if (result.css) {
        cssCache.set(id, result.css)
      } else {
        cssCache.delete(id)
      }

      // Store the parsed descriptor for HMR diffing.
      try {
        const descriptor = parse(code, id)
        prevDescriptors.set(id, descriptor)
      } catch {
        // Parsing failures are non-fatal for the descriptor cache –
        // the compile call above will surface errors properly.
      }

      // Build the final module code.  If the component has styles we
      // append a CSS import so that Vite picks up the virtual module
      // and processes it through its CSS pipeline (postcss etc).
      let output = result.code
      if (result.css) {
        const cssImportId = toCssId(id)
        output += `\nimport ${JSON.stringify(cssImportId)};\n`
      }

      return {
        code: output,
        map: null,
      }
    },

    // -------------------------------------------------------------------
    // HMR
    // -------------------------------------------------------------------

    handleHotUpdate(ctx: HmrContext) {
      const { file, read, server: hmrServer, modules } = ctx

      if (!file.endsWith(UTOPIA_EXT)) return undefined

      return (async () => {
        const source = await read()

        // ------------------------------------------------------------------
        // Parse the new descriptor and compare with the previous one.
        // ------------------------------------------------------------------
        let newDescriptor: ReturnType<typeof parse>
        try {
          newDescriptor = parse(source, file)
        } catch {
          // If parsing fails, fall through to a full update so the user
          // sees the compile error in the browser overlay.
          return undefined
        }

        const oldDescriptor = prevDescriptors.get(file)
        prevDescriptors.set(file, newDescriptor)

        // ------------------------------------------------------------------
        // Determine what changed.
        // ------------------------------------------------------------------
        const templateChanged = didBlockChange(
          oldDescriptor?.template,
          newDescriptor.template,
        )
        const scriptChanged = didBlockChange(
          oldDescriptor?.script,
          newDescriptor.script,
        )
        const styleChanged = didBlockChange(
          oldDescriptor?.style,
          newDescriptor.style,
        )

        // ------------------------------------------------------------------
        // Style-only change  -->  update only the virtual CSS module.
        // ------------------------------------------------------------------
        if (styleChanged && !templateChanged && !scriptChanged) {
          // Re-compile to refresh the CSS cache.
          const result = compile(source, {
            filename: file,
          })

          if (result.css) {
            cssCache.set(file, result.css)
          } else {
            cssCache.delete(file)
          }

          // Find the virtual CSS module in the module graph and invalidate it.
          const cssId = VIRTUAL_PREFIX + toCssId(file)
          const cssModule = hmrServer.moduleGraph.getModuleById(cssId)

          if (cssModule) {
            hmrServer.moduleGraph.invalidateModule(cssModule)
            // Return only the CSS module so Vite sends a style-only HMR
            // update (no component re-render).
            return [cssModule]
          }
        }

        // ------------------------------------------------------------------
        // Template or script changed  -->  full component re-render.
        // ------------------------------------------------------------------
        // Invalidate both the component module and the CSS module.
        const affectedModules: ModuleNode[] = []

        for (const mod of modules) {
          hmrServer.moduleGraph.invalidateModule(mod)
          affectedModules.push(mod)
        }

        // Also invalidate the CSS module so it picks up any concurrent
        // style changes.
        if (styleChanged) {
          const result = compile(source, {
            filename: file,
          })

          if (result.css) {
            cssCache.set(file, result.css)
          } else {
            cssCache.delete(file)
          }

          const cssId = VIRTUAL_PREFIX + toCssId(file)
          const cssModule = hmrServer.moduleGraph.getModuleById(cssId)
          if (cssModule) {
            hmrServer.moduleGraph.invalidateModule(cssModule)
            affectedModules.push(cssModule)
          }
        }

        return affectedModules.length > 0 ? affectedModules : undefined
      })()
    },
  }
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
  if (!oldBlock && !newBlock) return false
  if (!oldBlock || !newBlock) return true
  return oldBlock.content !== newBlock.content
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
  } = userConfig

  // Check whether the user already included the utopia plugin.
  const hasUtopiaPlugin = (userPlugins as Plugin[]).some(
    (p) => p && typeof p === 'object' && 'name' in p && p.name === 'utopia',
  )

  const plugins: Plugin[] = hasUtopiaPlugin
    ? (userPlugins as Plugin[])
    : [utopiaPlugin(), ...(userPlugins as Plugin[])]

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
      exclude: mergeUnique(
        userOptimizeDeps?.exclude ?? [],
        ['@matthesketh/utopia-core', '@matthesketh/utopia-runtime', '@matthesketh/utopia-router', '@matthesketh/utopia-server'],
      ),
    },

    ssr: {
      // Ensure UtopiaJS packages are bundled during SSR builds so the
      // runtime swap alias is applied correctly.
      noExternal: ['@matthesketh/utopia-core', '@matthesketh/utopia-runtime', '@matthesketh/utopia-router', '@matthesketh/utopia-server'],
    },
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Merge two string arrays, deduplicating entries.
 */
function mergeUnique(base: string[], additions: string[]): string[] {
  const set = new Set([...base, ...additions])
  return [...set]
}

