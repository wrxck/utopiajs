// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { meta, parse, parseForESLint } from './parser';

describe('parser', () => {
  it('parses the script block as typescript with source positions intact', () => {
    const code =
      '<template><p>hi</p></template>\n<script lang="ts">const x: number = 1;\n</script>';
    const { ast } = parseForESLint(code, { filePath: 'a.utopia' });
    expect(ast.type).toBe('Program');
    // the single statement is the variable declaration from the script block.
    expect(ast.body).toHaveLength(1);
    expect(ast.body[0].type).toBe('VariableDeclaration');
    // it sits on line 2, where the script block actually starts.
    expect(ast.body[0].loc?.start.line).toBe(2);
  });

  it('yields an empty program when there is no script block', () => {
    const { ast } = parseForESLint('<template><p>hi</p></template>', { filePath: 'a.utopia' });
    expect(ast.body).toHaveLength(0);
  });

  it('yields an empty program for an unparseable component', () => {
    // unclosed template throws in the SFC parser; the eslint parser must
    // swallow that and lint nothing instead of crashing the run.
    const { ast } = parseForESLint('<template><p>hi</p>', { filePath: 'a.utopia' });
    expect(ast.body).toHaveLength(0);
  });

  it('defaults the file path and options when none are given', () => {
    const { ast } = parseForESLint('<script>const a = 1;</script>');
    expect(ast.body).toHaveLength(1);
  });

  it('parse() returns just the AST', () => {
    const ast = parse('<script>const a = 1;</script>', { filePath: 'a.utopia' });
    expect(ast.type).toBe('Program');
    expect(ast.body).toHaveLength(1);
  });

  it('exposes parser meta', () => {
    expect(meta.name).toBe('@matthesketh/eslint-plugin-utopia');
  });
});
