import { describe, expect, it } from 'vitest';

import { isUtopiaFile, toScriptText } from '@/script-text';

const SFC = `<template>
  <p>{{ hello }}</p>
</template>

<script>
const hello = 'hi';
</script>

<style>
p { color: red; }
</style>
`;

describe('isUtopiaFile', () => {
  it('accepts a component and rejects a module', () => {
    expect(isUtopiaFile('/x/A.utopia')).toBe(true);
    expect(isUtopiaFile('/x/a.ts')).toBe(false);
  });
});

describe('toScriptText', () => {
  it('keeps the script body verbatim', () => {
    expect(toScriptText(SFC)).toContain("const hello = 'hi';");
  });

  it('blanks the template and the style', () => {
    const out = toScriptText(SFC);
    expect(out).not.toContain('<template>');
    expect(out).not.toContain('color: red');
  });

  it('preserves length exactly, so an offset needs no mapping', () => {
    expect(toScriptText(SFC)).toHaveLength(SFC.length);
  });

  it('preserves every line, so a line number needs no mapping', () => {
    expect(toScriptText(SFC).split('\n')).toHaveLength(SFC.split('\n').length);
  });

  it('puts the script on the same line it occupies in the source', () => {
    const line = (text: string) =>
      text.split('\n').findIndex((l) => l.includes("const hello = 'hi';"));
    expect(line(toScriptText(SFC))).toBe(line(SFC));
  });

  it('returns an all-blank view for a component with no script', () => {
    const noScript = '<template>\n  <p>x</p>\n</template>\n';
    expect(toScriptText(noScript).trim()).toBe('');
    expect(toScriptText(noScript)).toHaveLength(noScript.length);
  });
});
