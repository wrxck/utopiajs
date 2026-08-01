// a small, lossless splitter for the top-level blocks of a .utopia component.
//
// unlike the compiler's parser, this keeps the opening tag's attributes as raw
// text and never decodes the block contents — a formatter must not change what
// the author wrote, only how it is laid out. blocks are returned in source
// order so the printed output preserves the author's chosen ordering.

export type BlockName = 'template' | 'script' | 'style' | 'test';

export interface UtopiaBlock {
  type: 'block';
  name: BlockName;
  /** raw attribute text from the opening tag, trimmed (e.g. `lang="ts"`). */
  rawAttrs: string;
  /** verbatim contents between the opening and closing tags. */
  content: string;
  /** byte offset of the opening tag's `<`. */
  start: number;
  /** byte offset one past the closing tag's `>`. */
  end: number;
}

export interface UtopiaRoot {
  type: 'root';
  blocks: UtopiaBlock[];
  start: number;
  end: number;
}

/** matches the opening tag of any known block, capturing its raw attributes. */
const OPEN_TAG_RE = /<(template|script|style|test)(\s[^>]*)?>/g;

/**
 * find the offset one past the closing tag that matches an opening tag whose
 * body starts at `from`, accounting for nested same-name tags (a template may
 * legally contain native `<template>` elements). returns -1 when unclosed.
 */
function findBlockEnd(source: string, name: BlockName, from: number): number {
  const openRe = new RegExp(`<${name}(\\s[^>]*)?>`, 'g');
  const closeTag = `</${name}>`;

  const firstClose = source.indexOf(closeTag, from);
  if (firstClose === -1) return -1;

  let depth = 1;
  let cursor = from;

  while (depth > 0) {
    const closeIndex = source.indexOf(closeTag, cursor);
    if (closeIndex === -1) {
      // an opening tag counted above never gets its own closing tag — the usual
      // cause is the mandatory `<\/script>` escape inside a string, which hides
      // the close from a plain text scan. unwinding is impossible, so fall back
      // to the first closing tag. that is also where the compiler's parser ends
      // the block, so the formatter and the compiler always agree on the split.
      return firstClose + closeTag.length;
    }

    openRe.lastIndex = cursor;
    const openMatch = openRe.exec(source);

    if (openMatch !== null && openMatch.index < closeIndex) {
      // a nested same-name opening tag before the next close: go deeper.
      depth++;
      cursor = openMatch.index + openMatch[0].length;
    } else {
      depth--;
      cursor = closeIndex + closeTag.length;
    }
  }

  return cursor;
}

/**
 * the printer only ever emits the blocks this splitter returns, so anything the
 * splitter fails to claim would be silently deleted from the formatted file. a
 * formatter must never lose source: refuse the file instead, which surfaces as
 * a prettier parse error and leaves the file on disk untouched.
 */
function assertLossless(source: string, blocks: UtopiaBlock[]): void {
  let cursor = 0;

  for (const block of blocks) {
    if (source.slice(cursor, block.start).trim()) {
      throw new SyntaxError(`Unexpected content before <${block.name}> — only blocks are allowed`);
    }
    cursor = block.end;
  }

  if (source.slice(cursor).trim()) {
    throw new SyntaxError('Unexpected content after the last block — only blocks are allowed');
  }
}

export function splitBlocks(source: string): UtopiaRoot {
  const blocks: UtopiaBlock[] = [];

  // single left-to-right scan: after each block is captured the scan resumes
  // past its closing tag, so tags appearing *inside* a block body (e.g. a
  // <style> sample shown within <template>) never become blocks of their own.
  OPEN_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = OPEN_TAG_RE.exec(source)) !== null) {
    const name = match[1] as BlockName;
    const start = match.index;
    const bodyStart = start + match[0].length;

    const end = findBlockEnd(source, name, bodyStart);
    // resuming the scan inside an unclosed block would promote tags found in
    // its body to blocks of their own and drop the body itself, so refuse.
    if (end === -1) {
      throw new SyntaxError(`Unclosed <${name}> block — expected </${name}>`);
    }

    blocks.push({
      type: 'block',
      name,
      rawAttrs: (match[2] ?? '').trim(),
      content: source.slice(bodyStart, end - `</${name}>`.length),
      start,
      end,
    });

    OPEN_TAG_RE.lastIndex = end;
  }

  assertLossless(source, blocks);

  return { type: 'root', blocks, start: 0, end: source.length };
}
