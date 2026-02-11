// ============================================================================
// @matthesketh/utopia-compiler — Compile-time accessibility (a11y) checking
// ============================================================================
//
// Analyzes the template AST for common accessibility violations and emits
// warnings. Runs as a post-parse pass before codegen.
//
// Rules implemented:
//   1. img-alt          — <img> must have an alt attribute
//   2. click-keyboard   — Elements with @click should have keyboard support
//   3. anchor-content   — <a> must have content or aria-label
//   4. form-label       — <input>/<select>/<textarea> should have id+label or aria-label
//   5. no-distracting   — <marquee> and <blink> are forbidden
//   6. heading-order    — Heading levels should not skip (h1 -> h3)
//   7. aria-role        — aria role values must be valid
//   8. no-positive-tabindex — tabindex should not be positive
//   9. media-captions   — <video>/<audio> should have captions/accessible alternatives
//  10. anchor-valid     — <a> should have an href
// ============================================================================

import type { TemplateNode, ElementNode, Attribute, Directive } from './template-compiler';
import { NodeType } from './template-compiler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface A11yWarning {
  /** Rule ID (e.g. 'img-alt'). */
  rule: string;
  /** Human-readable message. */
  message: string;
  /** The element tag that triggered the warning. */
  tag: string;
}

export interface A11yOptions {
  /** Rules to disable (by rule ID). */
  disable?: string[];
}

// ---------------------------------------------------------------------------
// Valid ARIA roles (WAI-ARIA 1.2)
// ---------------------------------------------------------------------------

const VALID_ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'button',
  'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
  'contentinfo', 'definition', 'dialog', 'directory', 'document',
  'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading',
  'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
  'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'meter', 'navigation', 'none', 'note', 'option',
  'presentation', 'progressbar', 'radio', 'radiogroup', 'region',
  'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox',
  'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab',
  'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer',
  'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
]);

// Elements that are natively interactive (have implicit keyboard support).
const INTERACTIVE_ELEMENTS = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'details', 'summary',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAttr(node: ElementNode, name: string): Attribute | undefined {
  return node.attrs.find((a) => a.name === name);
}

function hasAttr(node: ElementNode, name: string): boolean {
  return node.attrs.some((a) => a.name === name);
}

function hasDirective(node: ElementNode, kind: string, arg?: string): boolean {
  return node.directives.some(
    (d) => d.kind === kind && (arg === undefined || d.arg === arg),
  );
}

function hasBoundAttr(node: ElementNode, name: string): boolean {
  return node.directives.some((d) => d.kind === 'bind' && d.arg === name);
}

function hasTextContent(node: ElementNode): boolean {
  return node.children.some(
    (c) =>
      (c.type === NodeType.Text && c.content.trim() !== '') ||
      c.type === NodeType.Interpolation,
  );
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

type RuleCheck = (node: ElementNode, warnings: A11yWarning[], ctx: WalkContext) => void;

interface WalkContext {
  lastHeadingLevel: number;
}

const rules: Record<string, RuleCheck> = {
  'img-alt'(node, warnings) {
    if (node.tag !== 'img') return;
    if (hasAttr(node, 'alt') || hasBoundAttr(node, 'alt')) return;
    // aria-label or aria-labelledby are acceptable alternatives.
    if (hasAttr(node, 'aria-label') || hasAttr(node, 'aria-labelledby')) return;
    // Decorative images can use role="presentation" or role="none".
    const role = getAttr(node, 'role');
    if (role && (role.value === 'presentation' || role.value === 'none')) return;
    warnings.push({
      rule: 'img-alt',
      message: '<img> element must have an alt attribute',
      tag: node.tag,
    });
  },

  'click-keyboard'(node, warnings) {
    const hasClick = hasDirective(node, 'on', 'click');
    if (!hasClick) return;
    // Interactive elements already have keyboard support.
    if (INTERACTIVE_ELEMENTS.has(node.tag)) return;
    // Check for role="button" or explicit keyboard handlers.
    const hasKeyboard =
      hasDirective(node, 'on', 'keydown') ||
      hasDirective(node, 'on', 'keyup') ||
      hasDirective(node, 'on', 'keypress');
    const role = getAttr(node, 'role');
    const hasInteractiveRole = role && (role.value === 'button' || role.value === 'link');
    if (!hasKeyboard && !hasInteractiveRole) {
      warnings.push({
        rule: 'click-keyboard',
        message: `<${node.tag}> with @click handler should also have a keyboard event handler or role="button"`,
        tag: node.tag,
      });
    }
    // Also check for tabindex if non-interactive.
    if (!hasAttr(node, 'tabindex') && !hasBoundAttr(node, 'tabindex')) {
      warnings.push({
        rule: 'click-keyboard',
        message: `<${node.tag}> with @click handler should have tabindex="0" for keyboard accessibility`,
        tag: node.tag,
      });
    }
  },

  'anchor-content'(node, warnings) {
    if (node.tag !== 'a') return;
    if (hasTextContent(node)) return;
    if (hasAttr(node, 'aria-label') || hasAttr(node, 'aria-labelledby')) return;
    // Check if it has child elements (could be an icon).
    const hasChildElements = node.children.some(
      (c) => c.type === NodeType.Element,
    );
    if (hasChildElements) return; // Assume child elements provide content.
    warnings.push({
      rule: 'anchor-content',
      message: '<a> element must have content, aria-label, or aria-labelledby',
      tag: node.tag,
    });
  },

  'form-label'(node, warnings) {
    const formElements = new Set(['input', 'select', 'textarea']);
    if (!formElements.has(node.tag)) return;
    // Hidden inputs don't need labels.
    const type = getAttr(node, 'type');
    if (type && type.value === 'hidden') return;
    // Check for labelling mechanisms.
    if (hasAttr(node, 'aria-label') || hasAttr(node, 'aria-labelledby')) return;
    if (hasAttr(node, 'id')) return; // Assumes a matching <label for="..."> exists.
    if (hasAttr(node, 'title')) return;
    warnings.push({
      rule: 'form-label',
      message: `<${node.tag}> should have an id (with matching <label>), aria-label, or aria-labelledby`,
      tag: node.tag,
    });
  },

  'no-distracting'(node, warnings) {
    if (node.tag === 'marquee' || node.tag === 'blink') {
      warnings.push({
        rule: 'no-distracting',
        message: `<${node.tag}> is distracting and inaccessible — do not use`,
        tag: node.tag,
      });
    }
  },

  'heading-order'(node, warnings, ctx) {
    const match = node.tag.match(/^h([1-6])$/);
    if (!match) return;
    const level = parseInt(match[1], 10);
    if (ctx.lastHeadingLevel > 0 && level > ctx.lastHeadingLevel + 1) {
      warnings.push({
        rule: 'heading-order',
        message: `Heading level <${node.tag}> skips from <h${ctx.lastHeadingLevel}> — headings should not skip levels`,
        tag: node.tag,
      });
    }
    ctx.lastHeadingLevel = level;
  },

  'aria-role'(node, warnings) {
    const role = getAttr(node, 'role');
    if (!role || !role.value) return;
    if (!VALID_ARIA_ROLES.has(role.value)) {
      warnings.push({
        rule: 'aria-role',
        message: `Invalid ARIA role "${role.value}" on <${node.tag}>`,
        tag: node.tag,
      });
    }
  },

  'no-positive-tabindex'(node, warnings) {
    const tabindex = getAttr(node, 'tabindex');
    if (!tabindex || !tabindex.value) return;
    const val = parseInt(tabindex.value, 10);
    if (!isNaN(val) && val > 0) {
      warnings.push({
        rule: 'no-positive-tabindex',
        message: `Avoid positive tabindex="${tabindex.value}" — it disrupts natural tab order`,
        tag: node.tag,
      });
    }
  },

  'media-captions'(node, warnings) {
    if (node.tag !== 'video' && node.tag !== 'audio') return;
    // Check for <track> child element.
    const hasTrack = node.children.some(
      (c) => c.type === NodeType.Element && (c as ElementNode).tag === 'track',
    );
    if (hasTrack) return;
    if (hasAttr(node, 'aria-label') || hasAttr(node, 'aria-labelledby')) return;
    warnings.push({
      rule: 'media-captions',
      message: `<${node.tag}> should have a <track> element for captions`,
      tag: node.tag,
    });
  },

  'anchor-valid'(node, warnings) {
    if (node.tag !== 'a') return;
    if (hasAttr(node, 'href') || hasBoundAttr(node, 'href')) return;
    // Allow anchors that act as buttons via role.
    const role = getAttr(node, 'role');
    if (role && role.value === 'button') return;
    warnings.push({
      rule: 'anchor-valid',
      message: '<a> element should have an href attribute',
      tag: node.tag,
    });
  },
};

// ---------------------------------------------------------------------------
// AST walker
// ---------------------------------------------------------------------------

function walkNodes(
  nodes: TemplateNode[],
  enabledRules: RuleCheck[],
  warnings: A11yWarning[],
  ctx: WalkContext,
): void {
  for (const node of nodes) {
    if (node.type === NodeType.Element) {
      for (const rule of enabledRules) {
        rule(node, warnings, ctx);
      }
      walkNodes(node.children, enabledRules, warnings, ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check a parsed template AST for accessibility issues.
 *
 * Returns an array of warnings. An empty array means no issues found.
 *
 * ```ts
 * const ast = parseTemplate('<img src="photo.jpg">');
 * const warnings = checkA11y(ast);
 * // [{ rule: 'img-alt', message: '...', tag: 'img' }]
 * ```
 */
export function checkA11y(
  ast: TemplateNode[],
  options?: A11yOptions,
): A11yWarning[] {
  const disabled = new Set(options?.disable ?? []);
  const enabledRules = Object.entries(rules)
    .filter(([id]) => !disabled.has(id))
    .map(([, fn]) => fn);

  const warnings: A11yWarning[] = [];
  const ctx: WalkContext = { lastHeadingLevel: 0 };
  walkNodes(ast, enabledRules, warnings, ctx);
  return warnings;
}
