// ---------------------------------------------------------------------------
// style-compiler.ts — Scoped CSS compiler
// ---------------------------------------------------------------------------
// Transforms CSS so that every selector is scoped to a unique data attribute,
// preventing style leakage between components.
//
// Given:
//   .counter { padding: 20px; }
//   h1 { color: blue; }
//
// With scopeId = "data-u-a1b2c3", produces:
//   .counter[data-u-a1b2c3] { padding: 20px; }
//   h1[data-u-a1b2c3] { color: blue; }
//
// The same `data-u-<hash>` attribute must be added to every element in the
// component's template (handled by the template compiler via the `scopeId`
// option).
// ---------------------------------------------------------------------------

export interface StyleCompileOptions {
  /** The raw CSS source. */
  source: string
  /** The filename for the component (used to generate a stable hash). */
  filename: string
  /** Whether the `<style>` block had the `scoped` attribute. */
  scoped: boolean
  /** Override the scope ID (useful for testing). */
  scopeId?: string
}

export interface StyleCompileResult {
  /** The (possibly transformed) CSS. */
  css: string
  /**
   * The data attribute that must be added to every element in the component
   * template so the scoped selectors match.  `null` when not scoped.
   */
  scopeId: string | null
}

/**
 * Compile a `<style>` block, applying scoped transformations when required.
 */
export function compileStyle(options: StyleCompileOptions): StyleCompileResult {
  const { source, filename, scoped, scopeId: overrideScopeId } = options

  if (!scoped) {
    return { css: source, scopeId: null }
  }

  const scopeId = overrideScopeId ?? generateScopeId(filename)

  const css = scopeSelectors(source, scopeId)

  return { css, scopeId }
}

// ---------------------------------------------------------------------------
// Scope-ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic scope ID from a filename.
 *
 * We use a simple DJB2-style hash (fast, no crypto dependency) and format it
 * as `data-u-XXXXXXXX`.
 */
export function generateScopeId(filename: string): string {
  let hash = 5381
  for (let i = 0; i < filename.length; i++) {
    // hash * 33 + char
    hash = ((hash << 5) + hash + filename.charCodeAt(i)) >>> 0
  }
  return `data-u-${hash.toString(16).padStart(8, '0')}`
}

// ---------------------------------------------------------------------------
// CSS selector scoping
// ---------------------------------------------------------------------------

/**
 * Walk through the CSS source and append `[scopeId]` to every selector.
 *
 * This is a lightweight CSS "parser" that handles the subset of CSS commonly
 * found in component styles:
 *
 *  - Rule sets:  `selector { declarations }`
 *  - Grouped selectors: `a, b { ... }`
 *  - Combinators: `.a .b`, `.a > .b`, `.a + .b`, `.a ~ .b`
 *  - Pseudo-classes/elements: `:hover`, `::before`
 *  - At-rules: `@media`, `@keyframes`, etc. (selectors inside are scoped;
 *    the at-rule itself is left untouched)
 *
 * We do NOT attempt to parse arbitrary CSS — a production implementation
 * would use a proper CSS parser (e.g. PostCSS).
 */
function scopeSelectors(css: string, scopeId: string): string {
  const result: string[] = []
  let pos = 0

  while (pos < css.length) {
    // Skip whitespace.
    if (/\s/.test(css[pos])) {
      result.push(css[pos])
      pos++
      continue
    }

    // CSS comment: /* ... */
    if (css[pos] === '/' && css[pos + 1] === '*') {
      const endIdx = css.indexOf('*/', pos + 2)
      if (endIdx === -1) {
        result.push(css.slice(pos))
        break
      }
      result.push(css.slice(pos, endIdx + 2))
      pos = endIdx + 2
      continue
    }

    // At-rule: @media, @keyframes, @supports, etc.
    if (css[pos] === '@') {
      const atResult = consumeAtRule(css, pos, scopeId)
      result.push(atResult.text)
      pos = atResult.end
      continue
    }

    // Closing brace (should not appear at top level, but be defensive).
    if (css[pos] === '}') {
      result.push('}')
      pos++
      continue
    }

    // Otherwise we expect a rule set: selectors { declarations }
    const ruleResult = consumeRuleSet(css, pos, scopeId)
    result.push(ruleResult.text)
    pos = ruleResult.end
  }

  return result.join('')
}

interface ConsumeResult {
  text: string
  end: number
}

/**
 * Consume an at-rule starting at `pos`.  Handles both block at-rules
 * (`@media { ... }`) and statement at-rules (`@import ...;`).
 */
function consumeAtRule(css: string, pos: number, scopeId: string): ConsumeResult {
  // Read the at-keyword and everything up to `{` or `;`.
  const start = pos
  let depth = 0
  let headerEnd = -1

  for (let i = pos; i < css.length; i++) {
    if (css[i] === '{') {
      headerEnd = i
      break
    }
    if (css[i] === ';') {
      // Statement at-rule (e.g. @import).
      return { text: css.slice(start, i + 1), end: i + 1 }
    }
  }

  if (headerEnd === -1) {
    // Malformed — return rest of input.
    return { text: css.slice(start), end: css.length }
  }

  const header = css.slice(start, headerEnd)

  // Is this @keyframes?  If so, don't scope the contents.
  const isKeyframes = /^@(?:-\w+-)?keyframes\b/.test(header.trim())

  // Find the matching closing brace.
  depth = 1
  let bodyStart = headerEnd + 1
  let bodyEnd = headerEnd + 1
  for (let i = bodyStart; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
    bodyEnd = i
  }

  const body = css.slice(bodyStart, bodyEnd)

  let scopedBody: string
  if (isKeyframes) {
    scopedBody = body
  } else {
    scopedBody = scopeSelectors(body, scopeId)
  }

  return {
    text: `${header}{${scopedBody}}`,
    end: bodyEnd + 1,
  }
}

/**
 * Consume a CSS rule set: `selector-list { declarations }`.
 */
function consumeRuleSet(css: string, pos: number, scopeId: string): ConsumeResult {
  // Find the opening brace.
  const braceIdx = css.indexOf('{', pos)
  if (braceIdx === -1) {
    // No more rules — return the rest as-is (might be trailing whitespace).
    return { text: css.slice(pos), end: css.length }
  }

  const selectorText = css.slice(pos, braceIdx)

  // Find the matching closing brace (no nesting expected inside declarations,
  // but be safe).
  let depth = 1
  let endIdx = braceIdx + 1
  for (; endIdx < css.length && depth > 0; endIdx++) {
    if (css[endIdx] === '{') depth++
    else if (css[endIdx] === '}') depth--
  }

  const declarations = css.slice(braceIdx + 1, endIdx - 1)

  // Scope each selector in the comma-separated list.
  const scopedSelectors = selectorText
    .split(',')
    .map((sel) => scopeSingleSelector(sel.trim(), scopeId))
    .join(', ')

  return {
    text: `${scopedSelectors} {${declarations}}`,
    end: endIdx,
  }
}

/**
 * Append the scope attribute selector to a single CSS selector.
 *
 * The attribute is added to the *last* simple selector in the compound
 * selector so that it targets the element itself, not an ancestor.
 *
 * Examples:
 *   `.foo`         -> `.foo[data-u-xxx]`
 *   `.foo .bar`    -> `.foo .bar[data-u-xxx]`
 *   `.foo > .bar`  -> `.foo > .bar[data-u-xxx]`
 *   `h1:hover`     -> `h1[data-u-xxx]:hover`
 *   `h1::before`   -> `h1[data-u-xxx]::before`
 */
function scopeSingleSelector(selector: string, scopeId: string): string {
  if (!selector) return selector

  const attr = `[${scopeId}]`

  // Find the position to insert the scope attribute.
  // We want to insert *before* any pseudo-element (::) or pseudo-class (:)
  // that follows the last simple selector.
  //
  // Strategy: work from the end of the selector backwards.
  //  1. Strip trailing pseudo-elements and pseudo-classes.
  //  2. Insert the scope attribute.
  //  3. Re-append the pseudo-elements/classes.

  // Match trailing pseudo-elements/classes: e.g. `:hover`, `::before`,
  // `:nth-child(2n)`.
  const pseudoRe = /(?:::?[\w-]+(?:\([^)]*\))?)+$/
  const pseudoMatch = selector.match(pseudoRe)

  if (pseudoMatch) {
    const beforePseudo = selector.slice(0, pseudoMatch.index!)
    return `${beforePseudo}${attr}${pseudoMatch[0]}`
  }

  return `${selector}${attr}`
}
