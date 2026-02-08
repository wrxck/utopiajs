// ---------------------------------------------------------------------------
// index.ts — Main entry point for @matthesketh/utopia-compiler
// ---------------------------------------------------------------------------
// Provides the top-level `compile()` function that orchestrates SFC parsing,
// template compilation, and style compilation into a single result.
// ---------------------------------------------------------------------------

export { parse, type SFCDescriptor, type SFCBlock, SFCParseError } from './parser'
export {
  compileTemplate,
  parseTemplate,
  type TemplateCompileOptions,
  type TemplateCompileResult,
} from './template-compiler'
export {
  compileStyle,
  generateScopeId,
  type StyleCompileOptions,
  type StyleCompileResult,
} from './style-compiler'

import { parse } from './parser'
import { compileTemplate } from './template-compiler'
import { compileStyle, generateScopeId } from './style-compiler'

// ---- Public types ----------------------------------------------------------

export interface CompileOptions {
  /** Filename for error messages and scope-id generation. */
  filename?: string
  /** Override the scope ID for testing. */
  scopeId?: string
}

export interface CompileResult {
  /** The compiled JavaScript module source. */
  code: string
  /** Extracted CSS (with scoping applied if the style block is `scoped`). */
  css: string
  /** Source map (reserved for future use). */
  map?: unknown
}

// ---- Main compile function -------------------------------------------------

/**
 * Compile a `.utopia` single-file component source string.
 *
 * Returns the generated JavaScript module code and CSS string.
 *
 * The generated JS module has the shape:
 * ```js
 * import { ... } from '@matthesketh/utopia-runtime'
 *
 * // <script> block contents (user code) inlined here
 *
 * export default function render(_ctx) { ... }
 * ```
 *
 * The caller (e.g. the Vite plugin) is responsible for injecting the CSS
 * into the page (via a `<style>` tag, or a CSS module import, etc.).
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const filename = options.filename ?? 'anonymous.utopia'

  // 1. Parse the SFC.
  const descriptor = parse(source, filename)

  // 2. Compile the style block (if present) to determine scoping.
  let css = ''
  let scopeId: string | null = null

  if (descriptor.style) {
    const isScoped = 'scoped' in descriptor.style.attrs
    const styleResult = compileStyle({
      source: descriptor.style.content,
      filename,
      scoped: isScoped,
      scopeId: options.scopeId,
    })
    css = styleResult.css
    scopeId = styleResult.scopeId
  }

  // 3. Compile the template block.
  let renderModule = ''
  if (descriptor.template) {
    const templateResult = compileTemplate(descriptor.template.content, {
      scopeId: scopeId ?? undefined,
    })
    renderModule = templateResult.code
  }

  // 4. Assemble the final JavaScript module.
  //
  // Structure:
  //   - Runtime helper imports (from template compilation)
  //   - User script block (verbatim)
  //   - Render function
  //
  // We split the render module's import line from the function body so we can
  // merge the user script in between.
  const { imports, body } = splitModuleParts(renderModule)

  const scriptContent = descriptor.script?.content ?? ''

  const parts: string[] = []

  // Imports from the render function.
  if (imports) {
    parts.push(imports)
  }

  // User script (may contain its own imports, which is fine — bundlers
  // handle multiple import sections or we could hoist them, but for now
  // this is sufficient for the compilation output).
  if (scriptContent.trim()) {
    parts.push(scriptContent.trim())
  }

  // Render function body.
  if (body) {
    parts.push(body)
  }

  const code = parts.join('\n\n') + '\n'

  return { code, css }
}

// ---- Internal helpers -------------------------------------------------------

/**
 * Split the generated render module into its import declaration(s) and the
 * function body.  This allows us to place the user script between them.
 */
function splitModuleParts(moduleCode: string): { imports: string; body: string } {
  // The template compiler generates code in the form:
  //   import { ... } from '@matthesketh/utopia-runtime'
  //
  //   export default function render(_ctx) { ... }
  //
  // We split at the first blank line (double newline).
  const idx = moduleCode.indexOf('\n\n')
  if (idx === -1) {
    return { imports: '', body: moduleCode }
  }

  const imports = moduleCode.slice(0, idx).trim()
  const body = moduleCode.slice(idx).trim()
  return { imports, body }
}
