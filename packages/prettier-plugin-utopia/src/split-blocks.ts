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

const BLOCK_NAMES: BlockName[] = ['template', 'script', 'style', 'test'];

export function splitBlocks(source: string): UtopiaRoot {
  const blocks: UtopiaBlock[] = [];

  for (const name of BLOCK_NAMES) {
    // match an opening tag with optional attributes, then the lazy body up to
    // the matching closing tag. block names never nest within themselves at the
    // top level, so a non-greedy body is sufficient and safe.
    const re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      blocks.push({
        type: 'block',
        name,
        rawAttrs: (match[1] ?? '').trim(),
        content: match[2],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  blocks.sort((a, b) => a.start - b.start);
  return { type: 'root', blocks, start: 0, end: source.length };
}
