// ---------------------------------------------------------------------------
// parser.ts — Single-File Component (.utopia) parser
// ---------------------------------------------------------------------------
// Extracts <template>, <script>, and <style> top-level blocks from an SFC
// source string.  Each block preserves its raw inner content, any attributes
// declared on the opening tag (e.g. `scoped` on <style>), and source-position
// offsets suitable for downstream source-map generation.
// ---------------------------------------------------------------------------

/** A single top-level block extracted from the SFC. */
export interface SFCBlock {
  /** The raw content between the opening and closing tags. */
  content: string;
  /** Attributes on the opening tag.  Boolean attrs have value `true`. */
  attrs: Record<string, string | true>;
  /** Byte offset of the opening tag's `<` in the original source. */
  start: number;
  /** Byte offset one past the closing tag's `>` in the original source. */
  end: number;
}

/** The result of parsing a `.utopia` single-file component. */
export interface SFCDescriptor {
  template: SFCBlock | null;
  script: SFCBlock | null;
  style: SFCBlock | null;
  filename: string;
}

// ---- Regex Constants --------------------------------------------------------

/** Matches opening tags for the three known SFC block types. */
export const BLOCK_RE = /<(template|script|style)([\s][^>]*)?\s*>/g;

/** Matches a single attribute in an opening tag (name, optional quoted/unquoted value). */
export const ATTR_RE = /([a-zA-Z_][\w-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;

// ---- Implementation --------------------------------------------------------

/**
 * Parse a `.utopia` SFC source string into its constituent blocks.
 *
 * The parser only looks for *top-level* `<template>`, `<script>`, and
 * `<style>` tags.  Anything else at the top level is silently ignored.
 */
export function parse(source: string, filename: string = 'anonymous.utopia'): SFCDescriptor {
  const descriptor: SFCDescriptor = {
    template: null,
    script: null,
    style: null,
    filename,
  };

  // We use a regex to locate opening tags for the three known block types.
  // This is safe because we only need to find *top-level* tags — they are
  // never nested inside one another.
  BLOCK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;

  while ((match = BLOCK_RE.exec(source)) !== null) {
    const tagName = match[1] as 'template' | 'script' | 'style';
    const attrString = match[2] || '';
    const openTagStart = match.index;
    const openTagEnd = openTagStart + match[0].length;

    // Parse attributes on the opening tag.
    const attrs = parseAttributes(attrString);

    // Find the corresponding closing tag.
    const closeTag = `</${tagName}>`;
    const closeIndex = source.indexOf(closeTag, openTagEnd);

    if (closeIndex === -1) {
      throw new SFCParseError(
        `Unclosed <${tagName}> block — expected </${tagName}>`,
        filename,
        positionAt(source, openTagStart),
      );
    }

    const content = source.slice(openTagEnd, closeIndex);
    const blockEnd = closeIndex + closeTag.length;

    const block: SFCBlock = {
      content,
      attrs,
      start: openTagStart,
      end: blockEnd,
    };

    if (descriptor[tagName] !== null) {
      throw new SFCParseError(
        `Duplicate <${tagName}> block — only one is allowed per component`,
        filename,
        positionAt(source, openTagStart),
      );
    }

    descriptor[tagName] = block;

    // Advance past the closing tag so the regex doesn't match inside the
    // block content (e.g. a nested <template> inside the template block).
    BLOCK_RE.lastIndex = blockEnd;
  }

  return descriptor;
}

// ---- Attribute parsing -----------------------------------------------------

function parseAttributes(raw: string): Record<string, string | true> {
  const attrs: Record<string, string | true> = {};
  let m: RegExpExecArray | null;

  // Reset lastIndex in case the regex was previously used.
  ATTR_RE.lastIndex = 0;

  while ((m = ATTR_RE.exec(raw)) !== null) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? true;
    attrs[name] = value;
  }

  return attrs;
}

// ---- Error helpers ---------------------------------------------------------

interface SourcePosition {
  line: number;
  column: number;
}

function positionAt(source: string, offset: number): SourcePosition {
  let line = 1;
  let column = 0;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { line, column };
}

export class SFCParseError extends Error {
  filename: string;
  position: SourcePosition;

  constructor(message: string, filename: string, position: SourcePosition) {
    super(`${filename}:${position.line}:${position.column} ${message}`);
    this.name = 'SFCParseError';
    this.filename = filename;
    this.position = position;
  }
}
