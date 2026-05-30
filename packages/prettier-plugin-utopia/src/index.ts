// @matthesketh/prettier-plugin-utopia — prettier support for .utopia
// single-file components.
//
// the component is split into its top-level blocks; each block's body is then
// handed to prettier's own well-tested sub-formatter via the embed mechanism —
// html for <template>, typescript for <script>/<test>, and css/scss/less for
// <style>. this keeps formatting safe and idempotent: we never reprint from a
// lossy ast, we only re-indent the blocks and delegate their contents.

import {
  type AstPath,
  doc,
  type Parser,
  type Plugin,
  type Printer,
  type SupportLanguage,
} from 'prettier';

import { type BlockName, splitBlocks, type UtopiaBlock, type UtopiaRoot } from './split-blocks';

const { hardline, indent, join } = doc.builders;

type AnyNode = UtopiaRoot | UtopiaBlock;

export const languages: SupportLanguage[] = [
  {
    name: 'UtopiaJS',
    parsers: ['utopia'],
    extensions: ['.utopia'],
    vscodeLanguageIds: ['utopia'],
  },
];

export const parsers: Record<string, Parser<AnyNode>> = {
  utopia: {
    parse: (text) => splitBlocks(text),
    astFormat: 'utopia-ast',
    locStart: (node) => node.start,
    locEnd: (node) => node.end,
  },
};

// pick the sub-parser prettier should use for a given block. typescript is a
// superset of javascript, so it is the safe default for script and test blocks
// regardless of whether a `lang` attribute is present.
function parserForBlock(block: UtopiaBlock): string {
  if (block.name === 'template') return 'html';
  if (block.name === 'style') {
    if (/lang\s*=\s*["']?scss/.test(block.rawAttrs)) return 'scss';
    if (/lang\s*=\s*["']?less/.test(block.rawAttrs)) return 'less';
    return 'css';
  }
  return 'typescript';
}

function openingTag(block: UtopiaBlock): string {
  return block.rawAttrs ? `<${block.name} ${block.rawAttrs}>` : `<${block.name}>`;
}

export const printers: Record<string, Printer<AnyNode>> = {
  'utopia-ast': {
    print(path, _options, print) {
      const node = path.node;
      if (node.type === 'root') {
        // a blank line between blocks, and a trailing newline at end of file.
        return [join([hardline, hardline], path.map(print, 'blocks')), hardline];
      }
      // synchronous fallback only — the embed below normally handles blocks and
      // returns the contents formatted by the relevant sub-formatter.
      const trimmed = node.content.trim();
      const closing = `</${node.name}>`;
      if (!trimmed) return [openingTag(node), closing];
      return [openingTag(node), indent([hardline, trimmed]), hardline, closing];
    },

    embed(path) {
      const node = path.node;
      if (node.type !== 'block') return null;

      return async (textToDoc) => {
        const closing = `</${node.name}>`;
        if (!node.content.trim()) return [openingTag(node), closing];

        try {
          const body = await textToDoc(node.content, { parser: parserForBlock(node) });
          return [openingTag(node), indent([hardline, body]), hardline, closing];
        } catch {
          // a block prettier cannot parse is left untouched (still re-indented),
          // so a single malformed block never blocks formatting the rest.
          return [openingTag(node), indent([hardline, node.content.trim()]), hardline, closing];
        }
      };
    },
  },
};

export type { BlockName, UtopiaBlock, UtopiaRoot };

const plugin: Plugin<AnyNode> = { languages, parsers, printers };
export default plugin;
