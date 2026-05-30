// rule: flag named html entities in the template that the utopia compiler does
// not decode. the compiler only decodes a fixed set of named entities (plus all
// numeric references); anything outside that set is emitted verbatim, so an
// author writing `&minus;` expecting a real minus sign instead ships the literal
// text "&minus;". numeric references and the literal character both work, so we
// steer authors towards those.

import { KNOWN_NAMED_ENTITIES, parse as parseSfc } from '@matthesketh/utopia-compiler';
import type { Rule } from 'eslint';

const NAMED_ENTITY = /&([a-zA-Z][a-zA-Z0-9]*);/g;

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow named html entities the utopia compiler does not decode (use a numeric reference or the literal character)',
      recommended: true,
    },
    schema: [],
    messages: {
      undecoded:
        "Named entity '&{{name}};' is not decoded by the Utopia compiler and will render literally. Use a numeric character reference or the literal character instead.",
    },
  },
  create(context) {
    return {
      Program(): void {
        const sourceCode = context.sourceCode;
        const text = sourceCode.text;

        let descriptor;
        try {
          descriptor = parseSfc(text, context.filename);
        } catch {
          // unparseable component: the parser already surfaces that; nothing to do.
          return;
        }
        if (!descriptor.template) return;

        // contents begin just past the template's opening tag.
        const contentStart = text.indexOf('>', descriptor.template.start) + 1;
        const content = descriptor.template.content;

        NAMED_ENTITY.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = NAMED_ENTITY.exec(content)) !== null) {
          const name = match[1];
          if (KNOWN_NAMED_ENTITIES.has(name)) continue;

          const start = contentStart + match.index;
          const end = start + match[0].length;
          context.report({
            loc: {
              start: sourceCode.getLocFromIndex(start),
              end: sourceCode.getLocFromIndex(end),
            },
            messageId: 'undecoded',
            data: { name },
          });
        }
      },
    };
  },
};

export default rule;
