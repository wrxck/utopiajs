// ============================================================================
// @matthesketh/utopia-server — Shared HTML serialization utilities
// ============================================================================

// Regex constants for HTML escaping.
export const AMPERSAND_RE = /&/g;
export const LESS_THAN_RE = /</g;
export const GREATER_THAN_RE = />/g;
export const DOUBLE_QUOTE_RE = /"/g;
export const SINGLE_QUOTE_RE = /'/g;
export const DOUBLE_DASH_RE = /--/g;
export const STYLE_CLOSE_RE = /<\/style/gi;

export const VALID_TAG = /^[a-zA-Z][a-zA-Z0-9-]*$/;
export function validateTag(tag: string): string {
  if (!VALID_TAG.test(tag)) throw new Error(`Invalid tag name: ${tag}`);
  return tag;
}

export const VALID_ATTR = /^[a-zA-Z_:@][a-zA-Z0-9_.:-]*$/;
export function validateAttr(name: string): string {
  if (!VALID_ATTR.test(name)) throw new Error(`Invalid attribute name: ${name}`);
  return name;
}

/**
 * Escape special HTML characters in text content.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(AMPERSAND_RE, '&amp;')
    .replace(LESS_THAN_RE, '&lt;')
    .replace(GREATER_THAN_RE, '&gt;');
}

/**
 * Escape special characters in attribute values.
 * Handles &, ", ', < and > to cover both quote styles.
 */
export function escapeAttr(str: string): string {
  return str
    .replace(AMPERSAND_RE, '&amp;')
    .replace(DOUBLE_QUOTE_RE, '&quot;')
    .replace(SINGLE_QUOTE_RE, '&#39;')
    .replace(LESS_THAN_RE, '&lt;')
    .replace(GREATER_THAN_RE, '&gt;');
}

/**
 * Sanitize comment text by replacing `--` sequences that would
 * prematurely close the comment.
 */
export function escapeComment(str: string): string {
  return str.replace(DOUBLE_DASH_RE, '-\u200B-');
}

/**
 * Escape CSS content to prevent `</style>` from closing the tag early.
 */
export function escapeStyleContent(css: string): string {
  return css.replace(STYLE_CLOSE_RE, '<\\/style');
}

// HTML void elements (self-closing, no closing tag).
export const VOID_ELEMENTS = new Set([
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
