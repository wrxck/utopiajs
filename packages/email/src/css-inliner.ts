// ============================================================================
// @matthesketh/utopia-email — CSS Inliner (zero dependencies)
// ============================================================================
//
// Inlines CSS declarations into `style=""` attributes on HTML elements.
// Input is machine-generated HTML from serializeVNode(), so it is always
// well-formed (no unclosed tags, no malformed attributes).
// ============================================================================

// ---------------------------------------------------------------------------
// Regex Constants
// ---------------------------------------------------------------------------

/** Matches CSS block comments. */
export const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

/** Matches a single whitespace character. */
export const WHITESPACE_CHAR_RE = /\s/;

/** Matches the child combinator (>) with optional surrounding whitespace. */
export const CHILD_COMBINATOR_RE = /\s*>\s*/g;

/** Matches CSS ID selectors (e.g. #my-id). */
export const ID_SELECTOR_RE = /#[a-zA-Z_-][\w-]*/g;

/** Matches CSS class selectors (e.g. .my-class). */
export const CLASS_SELECTOR_RE = /\.[a-zA-Z_-][\w-]*/g;

/** Matches CSS attribute selectors (e.g. [type="text"]). */
export const ATTR_SELECTOR_RE = /\[[^\]]+\]/g;

/** Matches CSS pseudo-classes (e.g. :hover, :nth-child(2)). */
export const PSEUDO_CLASS_RE = /:[\w-]+(\([^)]*\))?/g;

/** Matches CSS combinator characters used to split selector segments. */
export const COMBINATOR_SPLIT_RE = /[\s>+~]+/;

/** Matches a leading HTML tag name at the start of a selector segment. */
export const LEADING_TAG_RE = /^([a-zA-Z][\w-]*)/;

/** Matches a leading ID selector at the start of a selector segment. */
export const LEADING_ID_RE = /^#([a-zA-Z_-][\w-]*)/;

/** Matches a leading class selector at the start of a selector segment. */
export const LEADING_CLASS_RE = /^\.([a-zA-Z_-][\w-]*)/;

/** Matches a leading attribute selector at the start of a selector segment. */
export const LEADING_ATTR_RE = /^\[([^\]]+)\]/;

/** Matches leading/trailing quote characters. */
export const QUOTE_WRAP_RE = /^["']|["']$/g;

/** Matches a leading pseudo-class at the start of a selector segment. */
export const LEADING_PSEUDO_RE = /^:[\w-]+(\([^)]*\))?/;

/** Matches whitespace runs (for splitting). */
export const WHITESPACE_RUN_RE = /\s+/;

// the attribute region is captured with a single greedy `[^>]*` rather than the
// previous `(\s[^>]*?)?\s*` form. that form was ambiguous — the lazy `[^>]*?`
// and the trailing `\s*` could both match the same whitespace run, so a tag
// with a long whitespace run backtracked quadratically (a multi-second stall on
// a crafted attribute value). a single `[^>]*` has no such overlap.

/** matches an opening HTML tag, capturing tag name and attributes. */
export const OPENING_TAG_RE = /<([a-zA-Z][\w-]*)([^>]*)>/g;

/** matches any HTML tag (opening or closing), capturing tag name and attributes. */
export const ALL_TAGS_RE = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;

/** Matches an HTML attribute name and optional quoted value. */
export const ATTR_PARSE_RE = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*"([^"]*)")?/g;

/** Matches an existing style="..." attribute in an HTML tag. */
export const STYLE_ATTR_RE = /style="[^"]*"/;

/** Matches trailing CSS attribute selector operator chars (~, |, ^, $, *). */
export const ATTR_OPERATOR_SUFFIX_RE = /[~|^$*]$/;

/** Matches double quotes (escaped when writing style attribute values). */
export const DOUBLE_QUOTE_RE = /"/g;

// ---------------------------------------------------------------------------

interface CSSRule {
  selector: string;
  declarations: string;
}

interface Specificity {
  ids: number;
  classes: number;
  types: number;
}

interface MatchedStyle {
  declarations: string;
  specificity: Specificity;
  order: number;
}

// ---------------------------------------------------------------------------
// CSS parsing
// ---------------------------------------------------------------------------

/**
 * Extract CSS rule blocks from a CSS string. Skips @media and other at-rules.
 */
function parseCSS(css: string): CSSRule[] {
  const rules: CSSRule[] = [];
  // Remove comments
  const cleaned = css.replace(CSS_COMMENT_RE, '');

  let i = 0;
  while (i < cleaned.length) {
    // Skip whitespace
    while (i < cleaned.length && WHITESPACE_CHAR_RE.test(cleaned[i])) i++;
    if (i >= cleaned.length) break;

    // Skip @-rules (e.g. @media, @keyframes) — find matching closing brace
    if (cleaned[i] === '@') {
      let depth = 0;
      while (i < cleaned.length) {
        if (cleaned[i] === '{') depth++;
        if (cleaned[i] === '}') {
          depth--;
          if (depth <= 0) {
            i++;
            break;
          }
        }
        i++;
      }
      continue;
    }

    // Read selector (everything before '{')
    const selectorStart = i;
    while (i < cleaned.length && cleaned[i] !== '{') i++;
    if (i >= cleaned.length) break;
    const selector = cleaned.slice(selectorStart, i).trim();
    i++; // skip '{'

    // Read declarations (everything before '}')
    const declStart = i;
    while (i < cleaned.length && cleaned[i] !== '}') i++;
    const declarations = cleaned.slice(declStart, i).trim();
    i++; // skip '}'

    if (selector && declarations) {
      // Handle grouped selectors (e.g. ".a, .b")
      for (const sel of selector.split(',')) {
        const trimmed = sel.trim();
        if (trimmed) {
          rules.push({ selector: trimmed, declarations });
        }
      }
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Specificity calculation
// ---------------------------------------------------------------------------

function calculateSpecificity(selector: string): Specificity {
  let ids = 0;
  let classes = 0;
  let types = 0;

  // Remove child/descendant combinators for counting
  const parts = selector.replace(CHILD_COMBINATOR_RE, ' ').trim();

  // Count #id
  const idMatches = parts.match(ID_SELECTOR_RE);
  if (idMatches) ids = idMatches.length;

  // Count .class, [attr], :pseudo-class (but not ::pseudo-element)
  const classMatches = parts.match(CLASS_SELECTOR_RE);
  if (classMatches) classes += classMatches.length;
  const attrMatches = parts.match(ATTR_SELECTOR_RE);
  if (attrMatches) classes += attrMatches.length;

  // Count type selectors (tag names)
  // Split by combinators, then check each simple selector for a leading tag name
  const segments = parts.split(COMBINATOR_SPLIT_RE);
  for (const seg of segments) {
    // Strip IDs, classes, attributes, pseudo-classes from the segment
    const stripped = seg
      .replace(ID_SELECTOR_RE, '')
      .replace(CLASS_SELECTOR_RE, '')
      .replace(ATTR_SELECTOR_RE, '')
      .replace(PSEUDO_CLASS_RE, '')
      .trim();
    if (stripped && stripped !== '*') {
      types++;
    }
  }

  return { ids, classes, types };
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  if (a.ids !== b.ids) return a.ids - b.ids;
  if (a.classes !== b.classes) return a.classes - b.classes;
  return a.types - b.types;
}

// ---------------------------------------------------------------------------
// HTML element parsing & matching
// ---------------------------------------------------------------------------

interface ParsedElement {
  /** Full original opening tag string */
  fullTag: string;
  /** Start position in the HTML string */
  start: number;
  /** Tag name */
  tag: string;
  /** Class names */
  classes: string[];
  /** ID (if any) */
  id: string;
  /** All attributes as name=value map */
  attrs: Record<string, string>;
  /** Existing inline style */
  existingStyle: string;
  /** Ancestor tag+class chain for descendant matching */
  ancestors: AncestorInfo[];
}

interface AncestorInfo {
  tag: string;
  classes: string[];
  id: string;
  attrs: Record<string, string>;
}

/**
 * A simple selector (no combinators) parsed once into its constituent checks so
 * matching an element is pure comparisons — no regex work per element.
 */
interface CompiledSimple {
  /** False when the selector contains unsupported syntax — matches nothing. */
  valid: boolean;
  /** Tag name (lowercased), or null when the selector has no tag part. */
  tag: string | null;
  /** Required IDs (#a#b requires all — normally at most one). */
  ids: string[];
  /** Required class names. */
  classes: string[];
  /** Required attribute checks; value null means existence-only ([attr]). */
  attrs: { name: string; value: string | null }[];
}

/**
 * Parse a simple selector (no combinators) into a CompiledSimple. Mirrors the
 * grammar previously parsed inline per element: leading tag, then any of
 * #id, .class, [attr], :pseudo (skipped), * in any order.
 */
function compileSimpleSelector(selector: string): CompiledSimple {
  const compiled: CompiledSimple = { valid: true, tag: null, ids: [], classes: [], attrs: [] };
  let remaining = selector;

  // Extract tag (must be first if present)
  const tagMatch = remaining.match(LEADING_TAG_RE);
  if (tagMatch) {
    compiled.tag = tagMatch[1].toLowerCase();
    remaining = remaining.slice(tagMatch[1].length);
  }

  // Parse all remaining parts
  while (remaining.length > 0) {
    if (remaining[0] === '#') {
      const idMatch = remaining.match(LEADING_ID_RE);
      if (!idMatch) {
        compiled.valid = false;
        return compiled;
      }
      compiled.ids.push(idMatch[1]);
      remaining = remaining.slice(idMatch[0].length);
    } else if (remaining[0] === '.') {
      const classMatch = remaining.match(LEADING_CLASS_RE);
      if (!classMatch) {
        compiled.valid = false;
        return compiled;
      }
      compiled.classes.push(classMatch[1]);
      remaining = remaining.slice(classMatch[0].length);
    } else if (remaining[0] === '[') {
      const attrMatch = remaining.match(LEADING_ATTR_RE);
      if (!attrMatch) {
        compiled.valid = false;
        return compiled;
      }
      const attrExpr = attrMatch[1];
      // Handle [attr="value"], [attr], [attr^="value"], etc.
      const eqIdx = attrExpr.indexOf('=');
      if (eqIdx === -1) {
        // Just check attribute existence
        compiled.attrs.push({ name: attrExpr.trim(), value: null });
      } else {
        const attrName = attrExpr.slice(0, eqIdx).replace(ATTR_OPERATOR_SUFFIX_RE, '').trim();
        const attrValue = attrExpr
          .slice(eqIdx + 1)
          .replace(QUOTE_WRAP_RE, '')
          .trim();
        compiled.attrs.push({ name: attrName, value: attrValue });
      }
      remaining = remaining.slice(attrMatch[0].length);
    } else if (remaining[0] === ':') {
      // Skip pseudo-classes for email inlining
      const pseudoMatch = remaining.match(LEADING_PSEUDO_RE);
      if (!pseudoMatch) {
        compiled.valid = false;
        return compiled;
      }
      remaining = remaining.slice(pseudoMatch[0].length);
    } else if (remaining[0] === '*') {
      // Universal selector — matches anything
      remaining = remaining.slice(1);
    } else {
      compiled.valid = false;
      return compiled;
    }
  }

  return compiled;
}

/**
 * Check if a compiled simple selector matches an element's properties.
 */
function matchesCompiledSimple(
  compiled: CompiledSimple,
  tag: string,
  classes: string[],
  id: string,
  attrs: Record<string, string>,
): boolean {
  if (!compiled.valid) return false;
  if (compiled.tag !== null && tag.toLowerCase() !== compiled.tag) return false;
  for (const wanted of compiled.ids) {
    if (id !== wanted) return false;
  }
  for (const cls of compiled.classes) {
    if (!classes.includes(cls)) return false;
  }
  for (const check of compiled.attrs) {
    if (check.value === null) {
      if (!(check.name in attrs)) return false;
    } else if (attrs[check.name] !== check.value) {
      return false;
    }
  }
  return true;
}

/**
 * A full selector parsed once per rule (instead of once per rule x element).
 * `parts` holds the compiled combinator segments; `target` is the last part —
 * the simple selector the element itself must match.
 */
interface CompiledSelector {
  kind: 'single' | 'child' | 'descendant';
  parts: CompiledSimple[];
  target: CompiledSimple;
}

function compileSelector(selector: string): CompiledSelector {
  // Handle child combinator (>)
  if (selector.includes('>')) {
    const parts = selector.split(CHILD_COMBINATOR_RE).map((p) => compileSimpleSelector(p.trim()));
    return { kind: 'child', parts, target: parts[parts.length - 1] };
  }

  // Handle descendant combinator (space)
  const parts = selector.split(WHITESPACE_RUN_RE).map((p) => compileSimpleSelector(p));
  if (parts.length === 1) {
    return { kind: 'single', parts, target: parts[0] };
  }
  return { kind: 'descendant', parts, target: parts[parts.length - 1] };
}

/**
 * Check if a compiled selector matches an element.
 */
function selectorMatches(compiled: CompiledSelector, element: ParsedElement): boolean {
  const { kind, parts, target } = compiled;

  if (!matchesCompiledSimple(target, element.tag, element.classes, element.id, element.attrs)) {
    return false;
  }
  if (kind === 'single') return true;

  if (kind === 'child') {
    // Check parent chain — the immediate parent must match (for > combinator)
    const ancestors = element.ancestors;
    let depth = ancestors.length;
    for (let i = parts.length - 2; i >= 0; i--) {
      if (depth === 0) return false;
      const parent = ancestors[depth - 1];
      if (!matchesCompiledSimple(parts[i], parent.tag, parent.classes, parent.id, parent.attrs)) {
        return false;
      }
      depth--;
    }
    return true;
  }

  // Check ancestor chain for descendant matching
  let ancestorIdx = element.ancestors.length - 1;
  for (let i = parts.length - 2; i >= 0; i--) {
    const ancestorSelector = parts[i];
    let found = false;
    while (ancestorIdx >= 0) {
      const ancestor = element.ancestors[ancestorIdx];
      ancestorIdx--;
      if (
        matchesCompiledSimple(
          ancestorSelector,
          ancestor.tag,
          ancestor.classes,
          ancestor.id,
          ancestor.attrs,
        )
      ) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Style merging
// ---------------------------------------------------------------------------

/**
 * Parse a CSS declaration block into individual property→value pairs.
 */
function parseDeclarations(decl: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of decl.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (prop && value) {
      map.set(prop, value);
    }
  }
  return map;
}

/**
 * Merge multiple declaration blocks sorted by specificity, returning a single
 * style attribute value.
 */
function mergeStyles(matches: MatchedStyle[], existingStyle: string): string {
  // Sort by specificity, then by source order
  matches.sort((a, b) => {
    const specCmp = compareSpecificity(a.specificity, b.specificity);
    return specCmp !== 0 ? specCmp : a.order - b.order;
  });

  const merged = new Map<string, string>();

  for (const match of matches) {
    const decls = parseDeclarations(match.declarations);
    for (const [prop, value] of decls) {
      merged.set(prop, value);
    }
  }

  // Existing inline styles have highest priority
  if (existingStyle) {
    const existing = parseDeclarations(existingStyle);
    for (const [prop, value] of existing) {
      merged.set(prop, value);
    }
  }

  const parts: string[] = [];
  for (const [prop, value] of merged) {
    parts.push(`${prop}: ${value}`);
  }
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Main inliner
// ---------------------------------------------------------------------------

/**
 * Inline CSS declarations into HTML `style=""` attributes.
 *
 * @param html - Well-formed HTML string from serializeVNode()
 * @param css  - CSS string (scoped styles from component)
 * @returns    - HTML with inline styles applied
 */
export function inlineCSS(html: string, css: string): string {
  if (!css.trim()) return html;

  const rules = parseCSS(css);
  if (rules.length === 0) return html;

  // Hoist per-rule work out of the matching loop: compute specificity once per
  // rule (memoised across duplicate selectors from grouped rules) and parse
  // each selector once, instead of re-deriving both for every rule x element.
  const specificityCache = new Map<string, Specificity>();
  const prepared = rules.map((rule) => {
    let specificity = specificityCache.get(rule.selector);
    if (!specificity) {
      specificity = calculateSpecificity(rule.selector);
      specificityCache.set(rule.selector, specificity);
    }
    return {
      declarations: rule.declarations,
      specificity,
      compiled: compileSelector(rule.selector),
    };
  });

  // Find all opening tags and their positions
  const elements: ParsedElement[] = [];
  const ancestorStack: AncestorInfo[] = [];

  // Index elements by tag/class/id so rules targeting one of those only scan
  // the matching bucket instead of every element.
  const byTag = new Map<string, ParsedElement[]>();
  const byClass = new Map<string, ParsedElement[]>();
  const byId = new Map<string, ParsedElement[]>();
  const indexElement = (map: Map<string, ParsedElement[]>, key: string, element: ParsedElement) => {
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(element);
    } else {
      map.set(key, [element]);
    }
  };

  // Track tag nesting for ancestor info
  // We'll do a single pass collecting opening/closing tags
  ALL_TAGS_RE.lastIndex = 0;
  const voidElements = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);

  let match;
  while ((match = ALL_TAGS_RE.exec(html)) !== null) {
    const fullTag = match[0];
    const isClosing = fullTag[1] === '/';
    const tagName = match[1].toLowerCase();
    const attrsStr = match[2] || '';

    if (isClosing) {
      // Pop ancestor stack
      for (let i = ancestorStack.length - 1; i >= 0; i--) {
        if (ancestorStack[i].tag === tagName) {
          ancestorStack.splice(i);
          break;
        }
      }
      continue;
    }

    // Parse attributes
    const attrs: Record<string, string> = {};
    ATTR_PARSE_RE.lastIndex = 0;
    let attrMatch;
    while ((attrMatch = ATTR_PARSE_RE.exec(attrsStr)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2] ?? '';
    }

    const classes = (attrs['class'] || '').split(WHITESPACE_RUN_RE).filter(Boolean);
    const id = attrs['id'] || '';
    const existingStyle = attrs['style'] || '';

    const element: ParsedElement = {
      fullTag,
      start: match.index,
      tag: tagName,
      classes,
      id,
      attrs,
      existingStyle,
      ancestors: [...ancestorStack],
    };

    elements.push(element);
    indexElement(byTag, tagName, element);
    for (const cls of new Set(classes)) {
      indexElement(byClass, cls, element);
    }
    if (id) indexElement(byId, id, element);

    // Push to ancestor stack (unless void element)
    const isSelfClosing = fullTag.endsWith('/>') || voidElements.has(tagName);
    if (!isSelfClosing) {
      ancestorStack.push({ tag: tagName, classes, id, attrs });
    }
  }

  // Match rules to elements
  const elementMatches = new Map<ParsedElement, MatchedStyle[]>();
  const noElements: ParsedElement[] = [];

  for (let ruleIdx = 0; ruleIdx < prepared.length; ruleIdx++) {
    const rule = prepared[ruleIdx];
    const target = rule.compiled.target;

    // A target with unsupported syntax can never match — skip the scan.
    if (!target.valid) continue;

    // Fast path: any element matching the rule must carry the target's
    // id/class/tag, so only the indexed bucket needs scanning. Targets naming
    // none of those (universal, attribute-only, pseudo-only) fall back to the
    // full element list.
    let candidates: ParsedElement[];
    if (target.ids.length > 0) {
      candidates = byId.get(target.ids[0]) ?? noElements;
    } else if (target.classes.length > 0) {
      candidates = byClass.get(target.classes[0]) ?? noElements;
    } else if (target.tag !== null) {
      candidates = byTag.get(target.tag) ?? noElements;
    } else {
      candidates = elements;
    }

    for (const element of candidates) {
      if (selectorMatches(rule.compiled, element)) {
        let matches = elementMatches.get(element);
        if (!matches) {
          matches = [];
          elementMatches.set(element, matches);
        }
        matches.push({
          declarations: rule.declarations,
          specificity: rule.specificity,
          order: ruleIdx,
        });
      }
    }
  }

  // Build result by replacing opening tags with styled versions
  // Process from end to start so positions remain valid
  const sortedElements = [...elementMatches.entries()].sort((a, b) => b[0].start - a[0].start);

  let result = html;

  for (const [element, matches] of sortedElements) {
    const rawStyle = mergeStyles(matches, element.existingStyle);
    if (!rawStyle) continue;

    // Escape double quotes so a declaration value (e.g. font-family: "Arial",
    // or a crafted `x" onmouseover="…`) cannot terminate the style attribute.
    const mergedStyle = rawStyle.replace(DOUBLE_QUOTE_RE, '&quot;');

    const originalTag = element.fullTag;
    let newTag: string;

    if (element.existingStyle) {
      // Replace existing style attribute
      newTag = originalTag.replace(STYLE_ATTR_RE, `style="${mergedStyle}"`);
    } else {
      // Insert style attribute before the closing >
      const insertPos = originalTag.endsWith('/>')
        ? originalTag.length - 2
        : originalTag.length - 1;
      newTag =
        originalTag.slice(0, insertPos) + ` style="${mergedStyle}"` + originalTag.slice(insertPos);
    }

    result =
      result.slice(0, element.start) + newTag + result.slice(element.start + originalTag.length);
  }

  return result;
}
