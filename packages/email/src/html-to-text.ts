// ============================================================================
// @matthesketh/utopia-email — HTML to Plain Text Converter
// ============================================================================

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
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');

  // 2. Strip HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 3. Convert links: <a href="url">text</a> → text (url)
  text = text.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, content) => {
    const linkText = content.replace(/<[^>]+>/g, '').trim();
    if (linkText && href && linkText !== href) {
      return `${linkText} (${href})`;
    }
    return linkText || href;
  });

  // 4. Convert headings to UPPERCASE with surrounding newlines
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, content) => {
    const headingText = content.replace(/<[^>]+>/g, '').trim();
    return `\n\n${headingText.toUpperCase()}\n\n`;
  });

  // 5. Convert <br> / <br/> to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // 6. Convert <hr> to divider
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // 7. Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    const itemText = content.replace(/<[^>]+>/g, '').trim();
    return `\n- ${itemText}`;
  });

  // 8. Add newlines after block elements
  text = text.replace(/<\/(p|div|tr|table|blockquote)>/gi, '\n\n');
  text = text.replace(/<\/(td|th)>/gi, '\t');

  // 9. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // 10. Decode HTML entities
  text = text.replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
    // Named entities
    if (ENTITY_MAP[entity]) return ENTITY_MAP[entity];
    // Numeric entities
    const numMatch = entity.match(/^&#(\d+);$/);
    if (numMatch) return String.fromCharCode(parseInt(numMatch[1], 10));
    const hexMatch = entity.match(/^&#x([a-fA-F0-9]+);$/);
    if (hexMatch) return String.fromCharCode(parseInt(hexMatch[1], 16));
    return entity;
  });

  // 11. Collapse whitespace
  // Replace tabs with spaces, collapse multiple spaces (but preserve newlines)
  text = text.replace(/\t/g, '  ');
  text = text.replace(/[^\S\n]+/g, ' ');

  // Collapse 3+ consecutive newlines into 2
  text = text.replace(/\n{3,}/g, '\n\n');

  // Trim each line
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  // Trim leading/trailing whitespace
  text = text.trim();

  return text;
}
