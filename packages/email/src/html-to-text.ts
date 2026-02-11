// ============================================================================
// @matthesketh/utopia-email — HTML to Plain Text Converter
// ============================================================================

// ---------------------------------------------------------------------------
// Regex Constants
// ---------------------------------------------------------------------------

/** Matches <style>...</style> blocks (case-insensitive). */
export const STYLE_BLOCK_RE = /<style[^>]*>[\s\S]*?<\/style>/gi;

/** Matches <head>...</head> blocks (case-insensitive). */
export const HEAD_BLOCK_RE = /<head[^>]*>[\s\S]*?<\/head>/gi;

/** Matches HTML comments <!-- ... -->. */
export const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Matches anchor tags and captures href + inner content. */
export const ANCHOR_TAG_RE = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

/** Matches any HTML tag (opening, closing, or self-closing). Used to strip tags. */
export const HTML_TAG_RE = /<[^>]+>/g;

/** Matches heading tags (h1-h6) and captures inner content. */
export const HEADING_TAG_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;

/** Matches <br> and <br/> tags. */
export const BR_TAG_RE = /<br\s*\/?>/gi;

/** Matches <hr> and <hr/> tags. */
export const HR_TAG_RE = /<hr\s*\/?>/gi;

/** Matches <li>...</li> tags and captures inner content. */
export const LIST_ITEM_RE = /<li[^>]*>([\s\S]*?)<\/li>/gi;

/** Matches closing tags for block-level elements (p, div, tr, table, blockquote). */
export const BLOCK_CLOSE_TAG_RE = /<\/(p|div|tr|table|blockquote)>/gi;

/** Matches closing tags for table cells (td, th). */
export const TABLE_CELL_CLOSE_TAG_RE = /<\/(td|th)>/gi;

/** Matches HTML entities (named, numeric decimal, or numeric hex). */
export const HTML_ENTITY_RE = /&[a-zA-Z0-9#]+;/g;

/** Matches numeric decimal HTML entities like &#123;. */
export const NUMERIC_ENTITY_RE = /^&#(\d+);$/;

/** Matches numeric hex HTML entities like &#xAB;. */
export const HEX_ENTITY_RE = /^&#x([a-fA-F0-9]+);$/;

/** Matches tab characters. */
export const TAB_CHAR_RE = /\t/g;

/** Matches runs of whitespace that are not newlines. */
export const NON_NEWLINE_WHITESPACE_RE = /[^\S\n]+/g;

/** Matches 3 or more consecutive newlines. */
export const EXCESSIVE_NEWLINES_RE = /\n{3,}/g;

// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ndash;': '\u2013',
  '&mdash;': '\u2014',
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&trade;': '\u2122',
  '&hellip;': '\u2026',
  '&bull;': '\u2022',
};

/**
 * Convert HTML to plain text suitable as an email fallback.
 */
export function htmlToText(html: string): string {
  let text = html;

  // 1. Strip <style> and <head> blocks
  text = text.replace(STYLE_BLOCK_RE, '');
  text = text.replace(HEAD_BLOCK_RE, '');

  // 2. Strip HTML comments
  text = text.replace(HTML_COMMENT_RE, '');

  // 3. Convert links: <a href="url">text</a> → text (url)
  text = text.replace(ANCHOR_TAG_RE, (_, href, content) => {
    const linkText = content.replace(HTML_TAG_RE, '').trim();
    if (linkText && href && linkText !== href) {
      return `${linkText} (${href})`;
    }
    return linkText || href;
  });

  // 4. Convert headings to UPPERCASE with surrounding newlines
  text = text.replace(HEADING_TAG_RE, (_, content) => {
    const headingText = content.replace(HTML_TAG_RE, '').trim();
    return `\n\n${headingText.toUpperCase()}\n\n`;
  });

  // 5. Convert <br> / <br/> to newlines
  text = text.replace(BR_TAG_RE, '\n');

  // 6. Convert <hr> to divider
  text = text.replace(HR_TAG_RE, '\n---\n');

  // 7. Convert list items
  text = text.replace(LIST_ITEM_RE, (_, content) => {
    const itemText = content.replace(HTML_TAG_RE, '').trim();
    return `\n- ${itemText}`;
  });

  // 8. Add newlines after block elements
  text = text.replace(BLOCK_CLOSE_TAG_RE, '\n\n');
  text = text.replace(TABLE_CELL_CLOSE_TAG_RE, '\t');

  // 9. Strip all remaining HTML tags
  text = text.replace(HTML_TAG_RE, '');

  // 10. Decode HTML entities
  text = text.replace(HTML_ENTITY_RE, (entity) => {
    // Named entities
    if (ENTITY_MAP[entity]) return ENTITY_MAP[entity];
    // Numeric entities
    const numMatch = entity.match(NUMERIC_ENTITY_RE);
    if (numMatch) return String.fromCharCode(parseInt(numMatch[1], 10));
    const hexMatch = entity.match(HEX_ENTITY_RE);
    if (hexMatch) return String.fromCharCode(parseInt(hexMatch[1], 16));
    return entity;
  });

  // 11. Collapse whitespace
  // Replace tabs with spaces, collapse multiple spaces (but preserve newlines)
  text = text.replace(TAB_CHAR_RE, '  ');
  text = text.replace(NON_NEWLINE_WHITESPACE_RE, ' ');

  // Collapse 3+ consecutive newlines into 2
  text = text.replace(EXCESSIVE_NEWLINES_RE, '\n\n');

  // Trim each line
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  // Trim leading/trailing whitespace
  text = text.trim();

  return text;
}
