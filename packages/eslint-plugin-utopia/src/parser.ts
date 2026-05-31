// eslint parser for .utopia single-file components.
//
// strategy: blank out everything except the <script> block's contents (keeping
// newlines so positions line up exactly), then hand the result to
// @typescript-eslint/parser. the script is linted as real typescript with
// correct line/column, scope analysis and parser services — no offset remapping
// needed. template-level checks are handled by rules that read the raw source.

import { parse as parseSfc } from '@matthesketh/utopia-compiler';
import * as tsParser from '@typescript-eslint/parser';

export const meta = { name: '@matthesketh/eslint-plugin-utopia', version: '0.8.2' };

function blankExcept(code: string, start: number, end: number): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ');
  return blank(code.slice(0, start)) + code.slice(start, end) + blank(code.slice(end));
}

type ParseOptions = Record<string, unknown> & { filePath?: string };
type ParseResult = ReturnType<typeof tsParser.parseForESLint>;

export function parseForESLint(code: string, options: ParseOptions = {}): ParseResult {
  let scriptStart = 0;
  let scriptEnd = 0;
  try {
    const descriptor = parseSfc(code, options.filePath ?? 'component.utopia');
    if (descriptor.script) {
      const openTagEnd = code.indexOf('>', descriptor.script.start) + 1;
      scriptStart = openTagEnd;
      scriptEnd = openTagEnd + descriptor.script.content.length;
    }
  } catch {
    // unparseable component: lint nothing rather than crash the run.
  }

  const masked =
    scriptEnd > scriptStart
      ? blankExcept(code, scriptStart, scriptEnd)
      : code.replace(/[^\n]/g, ' ');

  return tsParser.parseForESLint(masked, {
    ...options,
    ecmaVersion: (options.ecmaVersion as never) ?? 'latest',
    sourceType: (options.sourceType as never) ?? 'module',
    loc: true,
    range: true,
    comment: true,
    tokens: true,
  });
}

export function parse(code: string, options?: ParseOptions): ParseResult['ast'] {
  return parseForESLint(code, options).ast;
}
